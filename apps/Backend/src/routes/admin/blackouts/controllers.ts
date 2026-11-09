import type { NextFunction, Request, Response } from 'express';
import { pool, withTransaction } from '../../../db.ts';
import type { Tx } from '../../../db.ts';
import { AppError, badRequest, notFound } from '../../../middleware/errors.ts';
import type { Principal } from '../../../core/tokens.ts';
import { nightsForStay, lockRoomDays, snapshotRoomDayState, readAvailability, findCommitmentConflicts } from '../../../core/inventory.ts';
import type { NightRef } from '../../../core/pricing.ts';
import { previewToken } from '../../../core/previewToken.ts';
import { recordAuditEvent } from '../../../core/audit.ts';
import { readBlackoutsQuerySchema, previewBlackoutSchema, applyBlackoutSchema, removeBlackoutSchema } from './schema.ts';

function addDays(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}
function toNights(roomTypeId: string, from: string, to: string): NightRef[] {
  return nightsForStay({ checkIn: from, checkOut: addDays(to, 1) }, [roomTypeId]);
}
/** Takes the caller's client explicitly: called from inside a transaction it must run on that
 *  same checked-out connection (Docs/Product.md §22). A `pool.query` here would check out a
 *  second connection while the first holds an open transaction — a pool-exhaustion deadlock
 *  under concurrency, and a read outside the transaction's own snapshot. */
async function roomTypeExists(client: Tx, roomTypeId: string): Promise<boolean> {
  const { rows } = await client.query<{ id: string }>(`SELECT id FROM room_types WHERE id = $1`, [roomTypeId]);
  return Boolean(rows[0]);
}

export async function readBlackoutsController(request: Request, response: Response, next: NextFunction): Promise<void> {
  const parsed = readBlackoutsQuerySchema.safeParse(request.query);
  if (!parsed.success) return next(badRequest(parsed.error));
  const { roomTypeId, from, to } = parsed.data;

  try {
    if (!(await roomTypeExists(pool, roomTypeId))) return next(notFound('Room type'));
    const availability = await readAvailability(pool, { stay: { checkIn: from, checkOut: addDays(to, 1) }, roomTypeIds: [roomTypeId] });
    response.status(200).json({
      roomTypeId,
      days: availability.filter((a) => a.isBlackout).map((a) => ({ stayDate: a.stayDate })),
    });
  } catch (error) {
    next(error);
  }
}

/** Pure dry run. Existing commitments are shown for awareness but never block a blackout
 *  (INV-27, AS-7) — the `conflicts` field here is informational, unlike inventory's. */
export async function previewBlackoutChangeController(request: Request, response: Response, next: NextFunction): Promise<void> {
  const parsed = previewBlackoutSchema.safeParse(request.body);
  if (!parsed.success) return next(badRequest(parsed.error));
  const { roomTypeId, from, to } = parsed.data;

  try {
    if (!(await roomTypeExists(pool, roomTypeId))) return next(notFound('Room type'));
    const nights = toNights(roomTypeId, from, to);
    const rows = await snapshotRoomDayState(pool, nights);
    const token = previewToken(rows);
    const existingCommitments = await findCommitmentConflicts(pool, { roomTypeId, from, to: addDays(to, 1), proposedAllotment: null, blackout: true });

    response.status(200).json({
      affected: rows.map((r) => ({ stayDate: r.stayDate, currentIsBlackout: r.isBlackout, currentAllotment: r.allotment, currentPricePaise: r.pricePaise })),
      conflicts: existingCommitments,
      previewToken: token,
    });
  } catch (error) {
    next(error);
  }
}

export async function applyBlackoutController(request: Request, response: Response, next: NextFunction): Promise<void> {
  const parsed = applyBlackoutSchema.safeParse(request.body);
  if (!parsed.success) return next(badRequest(parsed.error));
  const actor = response.locals.principal as Principal;
  const { roomTypeId, from, to, previewToken: suppliedToken } = parsed.data;

  try {
    await withTransaction(async (client) => {
      if (!(await roomTypeExists(client, roomTypeId))) throw notFound('Room type');
      const nights = toNights(roomTypeId, from, to);
      await lockRoomDays(client, nights);

      const currentRows = await snapshotRoomDayState(client, nights);
      const recomputed = previewToken(currentRows);
      if (recomputed !== suppliedToken) throw new AppError('stale_write', 'This range was edited since you last previewed it.');

      for (const night of nights) {
        await client.query(
          `INSERT INTO room_day (room_type_id, stay_date, is_blackout, updated_by)
           VALUES ($1, $2, true, $3)
           ON CONFLICT (room_type_id, stay_date) DO UPDATE SET is_blackout = true, updated_at = now(), updated_by = $3`,
          [night.roomTypeId, night.stayDate, actor.userId],
        );
      }
      await recordAuditEvent(client, {
        actorUserId: actor.userId, actorRole: actor.role, action: 'blackout.set', targetKind: 'room_day',
        targetId: roomTypeId, before: currentRows, after: { from, to, isBlackout: true },
      });
    });
    response.status(200).json({ roomTypeId, from, to, isBlackout: true });
  } catch (error) {
    next(error);
  }
}

export async function removeBlackoutController(request: Request, response: Response, next: NextFunction): Promise<void> {
  const parsed = removeBlackoutSchema.safeParse(request.body);
  if (!parsed.success) return next(badRequest(parsed.error));
  const actor = response.locals.principal as Principal;
  const { roomTypeId, from, to, previewToken: suppliedToken } = parsed.data;

  try {
    await withTransaction(async (client) => {
      if (!(await roomTypeExists(client, roomTypeId))) throw notFound('Room type');
      const nights = toNights(roomTypeId, from, to);
      await lockRoomDays(client, nights);

      const currentRows = await snapshotRoomDayState(client, nights);
      const recomputed = previewToken(currentRows);
      if (recomputed !== suppliedToken) throw new AppError('stale_write', 'This range was edited since you last previewed it.');

      await client.query(
        `UPDATE room_day SET is_blackout = false, updated_at = now(), updated_by = $1 WHERE room_type_id = $2 AND stay_date = ANY($3)`,
        [actor.userId, roomTypeId, nights.map((n) => n.stayDate)],
      );
      await recordAuditEvent(client, {
        actorUserId: actor.userId, actorRole: actor.role, action: 'blackout.set', targetKind: 'room_day',
        targetId: roomTypeId, before: currentRows, after: { from, to, isBlackout: false },
      });
    });
    response.status(200).json({ roomTypeId, from, to, isBlackout: false });
  } catch (error) {
    next(error);
  }
}
