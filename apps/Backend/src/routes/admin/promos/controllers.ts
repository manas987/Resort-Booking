import type { NextFunction, Request, Response } from 'express';
import { pool, withTransaction, PG, isPgError } from '../../../db.ts';
import { AppError, badRequest, notFound } from '../../../middleware/errors.ts';
import type { Principal } from '../../../core/tokens.ts';
import { recordAuditEvent } from '../../../core/audit.ts';
import { createPromoSchema, updatePromoSchema } from './schema.ts';

type PromoRow = {
  id: string;
  code: string;
  kind: string;
  value: number;
  max_uses: number | null;
  starts_at: string | null;
  ends_at: string | null;
  is_active: boolean;
};

function toPublicShape(row: PromoRow) {
  return {
    id: row.id,
    code: row.code,
    kind: row.kind,
    value: row.value,
    maxUses: row.max_uses,
    startsAt: row.starts_at,
    endsAt: row.ends_at,
    isActive: row.is_active,
  };
}

export async function readPromosController(_request: Request, response: Response, next: NextFunction): Promise<void> {
  try {
    // `usedCount` counts redemptions that are NOT released — deliberately the same expression
    // `core/booking.ts` enforces the cap with, so the number shown to a GM and the number that
    // exhausts the code can never disagree. A held redemption counts against the limit while
    // its booking is still in flight; releasing it frees the slot again.
    const { rows } = await pool.query<PromoRow & { used_count: number }>(
      `SELECT p.id, p.code, p.kind, p.value, p.max_uses, p.starts_at, p.ends_at, p.is_active,
              count(r.id) FILTER (WHERE r.state <> 'released')::int AS used_count
         FROM promo_codes p
         LEFT JOIN promo_redemptions r ON r.promo_id = p.id
        GROUP BY p.id
        ORDER BY p.created_at DESC`,
    );
    response.status(200).json({ items: rows.map((row) => ({ ...toPublicShape(row), usedCount: row.used_count })) });
  } catch (error) {
    next(error);
  }
}

export async function createPromoController(request: Request, response: Response, next: NextFunction): Promise<void> {
  const parsed = createPromoSchema.safeParse(request.body);
  if (!parsed.success) return next(badRequest(parsed.error));
  const actor = response.locals.principal as Principal;
  const { code, kind, value, maxUses, startsAt, endsAt } = parsed.data;

  try {
    const created = await withTransaction(async (client) => {
      const { rows } = await client.query<PromoRow>(
        `INSERT INTO promo_codes (code, kind, value, max_uses, starts_at, ends_at, created_by)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         RETURNING id, code, kind, value, max_uses, starts_at, ends_at, is_active`,
        [code, kind, value, maxUses ?? null, startsAt ?? null, endsAt ?? null, actor.userId],
      );
      const row = rows[0]!;
      await recordAuditEvent(client, {
        actorUserId: actor.userId, actorRole: actor.role, action: 'promo.create', targetKind: 'promo_code', targetId: row.id,
        after: toPublicShape(row),
      });
      return row;
    });
    response.status(201).json(toPublicShape(created));
  } catch (error) {
    if (isPgError(error, PG.UNIQUE_VIOLATION)) {
      next(new AppError('validation_failed', 'A promo code with that code already exists.'));
      return;
    }
    next(error);
  }
}

export async function updatePromoController(request: Request, response: Response, next: NextFunction): Promise<void> {
  const parsed = updatePromoSchema.safeParse(request.body);
  if (!parsed.success) return next(badRequest(parsed.error));
  const actor = response.locals.principal as Principal;
  const { promoId } = request.params as { promoId: string };
  const updates = parsed.data;

  try {
    const updated = await withTransaction(async (client) => {
      const { rows } = await client.query<PromoRow>(
        `SELECT id, code, kind, value, max_uses, starts_at, ends_at, is_active FROM promo_codes WHERE id = $1 FOR UPDATE`,
        [promoId],
      );
      const before = rows[0];
      if (!before) throw notFound('Promo code');
      if (before.kind === 'percent' && updates.value !== undefined && updates.value > 10000) {
        throw new AppError('validation_failed', 'Percent value cannot exceed 10000 bps (100%).');
      }

      const { rows: updatedRows } = await client.query<PromoRow>(
        `UPDATE promo_codes SET
           value = COALESCE($1, value), max_uses = COALESCE($2, max_uses),
           starts_at = CASE WHEN $3::boolean THEN $4::timestamptz ELSE starts_at END,
           ends_at = CASE WHEN $5::boolean THEN $6::timestamptz ELSE ends_at END,
           is_active = COALESCE($7, is_active), updated_at = now()
         WHERE id = $8
         RETURNING id, code, kind, value, max_uses, starts_at, ends_at, is_active`,
        [
          updates.value ?? null,
          updates.maxUses ?? null,
          'startsAt' in updates, updates.startsAt ?? null,
          'endsAt' in updates, updates.endsAt ?? null,
          updates.isActive ?? null,
          promoId,
        ],
      );
      const after = updatedRows[0]!;
      await recordAuditEvent(client, {
        actorUserId: actor.userId, actorRole: actor.role, action: 'promo.update', targetKind: 'promo_code', targetId: promoId,
        before: toPublicShape(before), after: toPublicShape(after),
      });
      return after;
    });
    response.status(200).json(toPublicShape(updated));
  } catch (error) {
    next(error);
  }
}

export async function readPromoRedemptionsController(request: Request, response: Response, next: NextFunction): Promise<void> {
  const { promoId } = request.params as { promoId: string };
  try {
    const { rows: promoRows } = await pool.query<{ id: string }>(`SELECT id FROM promo_codes WHERE id = $1`, [promoId]);
    if (!promoRows[0]) return next(notFound('Promo code'));

    const { rows } = await pool.query<{ id: string; booking_id: string; state: string; created_at: string }>(
      `SELECT id, booking_id, state, created_at FROM promo_redemptions WHERE promo_id = $1 ORDER BY created_at DESC`,
      [promoId],
    );
    const counts = { held: 0, consumed: 0, released: 0 };
    for (const row of rows) counts[row.state as keyof typeof counts] += 1;

    response.status(200).json({
      counts,
      items: rows.map((r) => ({ id: r.id, bookingId: r.booking_id, state: r.state, createdAt: r.created_at })),
    });
  } catch (error) {
    next(error);
  }
}
