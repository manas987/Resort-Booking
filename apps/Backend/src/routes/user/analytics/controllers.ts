import type { NextFunction, Request, Response } from 'express';
import { pool } from '../../../db.ts';
import { badRequest } from '../../../middleware/errors.ts';
import { recordAnalyticsEventSchema } from './schema.ts';

/** `anonId`/`sessionId` are random, first-party, client-generated values — nothing derived
 *  from IP, user agent or any other fingerprinting signal is ever read here. Deduplicated by
 *  `dedupe_key` so a funnel step counts once per session, no matter how many times the
 *  client's own retry logic posts it. */
export async function recordAnalyticsEventController(
  request: Request,
  response: Response,
  next: NextFunction,
): Promise<void> {
  const parsed = recordAnalyticsEventSchema.safeParse(request.body);
  if (!parsed.success) return next(badRequest(parsed.error));

  try {
    await pool.query(
      `INSERT INTO analytics_events (anon_id, session_id, type, dedupe_key, payload)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (dedupe_key) WHERE dedupe_key IS NOT NULL DO NOTHING`,
      [
        parsed.data.anonId,
        parsed.data.sessionId,
        parsed.data.type,
        parsed.data.dedupeKey ?? null,
        JSON.stringify(parsed.data.payload ?? {}),
      ],
    );
    response.status(201).json({});
  } catch (error) {
    next(error);
  }
}
