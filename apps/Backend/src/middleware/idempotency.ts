/**
 * The decision table is in Docs/04-contracts.md ("middleware/idempotency.ts — the decision
 * table") — do not improvise it. Required on POST /api/user/bookings and
 * POST /api/user/payments/:bookingId/attempts (1H).
 */
import { createHash } from 'node:crypto';
import type { NextFunction, Request, RequestHandler, Response } from 'express';
import { pool } from '../db.ts';
import { AppError } from './errors.ts';

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/** sha256 of the body with sorted keys — an identical body with reordered fields must hash
 *  the same. */
function canonicalHash(body: unknown): string {
  const canonical = JSON.stringify(sortKeys(body));
  return createHash('sha256').update(canonical).digest('hex');
}

function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([k, v]) => [k, sortKeys(v)]),
    );
  }
  return value;
}

type ExistingRow = {
  user_id: string | null;
  endpoint: string;
  request_hash: string;
  status: 'in_flight' | 'completed';
  response_code: number | null;
  response_body: unknown;
};

/** Reads Idempotency-Key (must be a UUIDv4), reserves or replays per the decision table, and
 *  sets response.locals.idempotencyKey. */
export function requireIdempotencyKey(endpoint: string): RequestHandler {
  return async (request: Request, response: Response, next: NextFunction): Promise<void> => {
    const key = request.get('idempotency-key');
    if (!key || !UUID_V4.test(key)) {
      next(new AppError('validation_failed', 'A valid Idempotency-Key header (UUIDv4) is required.'));
      return;
    }
    const userId = response.locals.principal?.userId ?? null;
    const requestHash = canonicalHash(request.body);

    try {
      const { rowCount } = await pool.query(
        `INSERT INTO idempotency_keys (key, user_id, endpoint, request_hash, status)
         VALUES ($1, $2, $3, $4, 'in_flight')
         ON CONFLICT (key) DO NOTHING`,
        [key, userId, endpoint, requestHash],
      );

      if (rowCount === 1) {
        response.locals.idempotencyKey = key;
        captureResponse(key, response);
        next();
        return;
      }

      const { rows } = await pool.query<ExistingRow>(
        `SELECT user_id, endpoint, request_hash, status, response_code, response_body
           FROM idempotency_keys WHERE key = $1`,
        [key],
      );
      const existing = rows[0];
      // The actor is part of the identity of a replay, not just the key and the body. Without
      // `user_id` here, one principal presenting another's key and body would be served the
      // stored response — somebody else's booking reference and contact details. A key that
      // belongs to a different principal is refused outright, never replayed (INV-30, INV-34).
      //
      // ponytail: `idempotency_keys.key` is a global PRIMARY KEY, so two principals cannot
      // hold the same key at all and the loser sees a 409 instead of getting their own slot.
      // Harmless at UUIDv4 collision odds; the clean form is a `(key, user_id)` primary key,
      // which is a migration, not a middleware change.
      if (
        !existing ||
        existing.user_id !== userId ||
        existing.endpoint !== endpoint ||
        existing.request_hash !== requestHash
      ) {
        next(new AppError('idempotency_key_reused', 'This Idempotency-Key was already used for a different request.'));
        return;
      }
      if (existing.status === 'in_flight') {
        next(new AppError('idempotency_key_reused', 'The original request with this key is still being processed.'));
        return;
      }
      // completed, same endpoint and hash — replay, never re-run the controller (INV-30).
      response.status(existing.response_code!).json(existing.response_body);
    } catch (error) {
      next(error);
    }
  };
}

/** Wraps response.json ONCE so the decision table's capture rule runs regardless of which
 *  controller branch responds. A 2xx is stored for replay; anything else is deleted so the
 *  client can legitimately retry with the same key. */
function captureResponse(key: string, response: Response): void {
  const originalJson = response.json.bind(response);
  response.json = ((body: unknown) => {
    const statusCode = response.statusCode;
    const write =
      statusCode >= 200 && statusCode < 300
        ? pool.query(
            `UPDATE idempotency_keys
               SET status = 'completed', response_code = $2, response_body = $3,
                   booking_id = $4, completed_at = now()
             WHERE key = $1`,
            [
              key,
              statusCode,
              JSON.stringify(body),
              typeof (body as { bookingId?: unknown } | null)?.bookingId === 'string'
                ? (body as { bookingId: string }).bookingId
                : null,
            ],
          )
        : pool.query(`DELETE FROM idempotency_keys WHERE key = $1`, [key]);

    // The DB write (completed vs. deleted) must land before the client can possibly see the
    // response and retry — otherwise a fast-enough duplicate could race the capture itself.
    write
      .then(() => originalJson(body))
      .catch((error: unknown) => {
        console.error('[idempotency] capture failed', (error as Error).message);
        originalJson(body);
      });
    return response;
  }) as Response['json'];
}
