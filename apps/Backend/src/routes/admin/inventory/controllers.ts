import type { NextFunction, Request, Response } from 'express';
import { pool, withTransaction } from '../../../db.ts';
import { AppError, badRequest, notFound } from '../../../middleware/errors.ts';
import type { Principal } from '../../../core/tokens.ts';
import { nightsForStay, lockRoomDays, snapshotRoomDayState, readAvailability, findCommitmentConflicts } from '../../../core/inventory.ts';
import type { NightRef } from '../../../core/pricing.ts';
import { previewToken } from '../../../core/previewToken.ts';
import { recordAuditEvent } from '../../../core/audit.ts';
import {
  readInventoryQuerySchema,
  updateBaseAllotmentSchema,
  previewAllotmentSchema,
  applyAllotmentSchema,
  removeAllotmentSchema,
} from './schema.ts';

function addDays(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}
/** `to` in these routes is inclusive; `nightsForStay` wants an exclusive checkout. */
function toNights(roomTypeId: string, from: string, to: string): NightRef[] {
  return nightsForStay({ checkIn: from, checkOut: addDays(to, 1) }, [roomTypeId]);
}

async function loadRoomTypeStock(roomTypeId: string): Promise<{ physicalStock: number; baseAllotment: number } | null> {
  const { rows } = await pool.query<{ physical_stock: number; base_allotment: number }>(
    `SELECT physical_stock, base_allotment FROM room_types WHERE id = $1`,
    [roomTypeId],
  );
  return rows[0] ? { physicalStock: rows[0].physical_stock, baseAllotment: rows[0].base_allotment } : null;
}

export async function readInventoryController(request: Request, response: Response, next: NextFunction): Promise<void> {
  const parsed = readInventoryQuerySchema.safeParse(request.query);
  if (!parsed.success) return next(badRequest(parsed.error));
  const { roomTypeId, from, to } = parsed.data;

  try {
    const stock = await loadRoomTypeStock(roomTypeId);
    if (!stock) return next(notFound('Room type'));
    const availability = await readAvailability(pool, { stay: { checkIn: from, checkOut: addDays(to, 1) }, roomTypeIds: [roomTypeId] });
    response.status(200).json({
      roomTypeId,
      baseAllotment: stock.baseAllotment,
      physicalStock: stock.physicalStock,
      days: availability.map((a) => ({ stayDate: a.stayDate, allotment: a.allotment, committed: a.committed, remaining: a.remaining, isBlackout: a.isBlackout })),
    });
  } catch (error) {
    next(error);
  }
}

export async function updateBaseAllotmentController(request: Request, response: Response, next: NextFunction): Promise<void> {
  const parsed = updateBaseAllotmentSchema.safeParse(request.body);
  if (!parsed.success) return next(badRequest(parsed.error));
  const actor = response.locals.principal as Principal;
  const { roomTypeId } = request.params as { roomTypeId: string };

  try {
    await withTransaction(async (client) => {
      const { rows } = await client.query<{ physical_stock: number; base_allotment: number }>(
        `SELECT physical_stock, base_allotment FROM room_types WHERE id = $1 FOR UPDATE`,
        [roomTypeId],
      );
      const stock = rows[0];
      if (!stock) throw notFound('Room type');
      if (parsed.data.baseAllotment > stock.physical_stock) {
        throw new AppError('validation_failed', 'Base allotment cannot exceed physical stock.');
      }
      await client.query(`UPDATE room_types SET base_allotment = $1 WHERE id = $2`, [parsed.data.baseAllotment, roomTypeId]);
      await recordAuditEvent(client, {
        actorUserId: actor.userId, actorRole: actor.role, action: 'allotment.update', targetKind: 'room_type', targetId: roomTypeId,
        before: { baseAllotment: stock.base_allotment }, after: { baseAllotment: parsed.data.baseAllotment },
      });
    });
    response.status(200).json({ roomTypeId, baseAllotment: parsed.data.baseAllotment });
  } catch (error) {
    next(error);
  }
}

/** Pure dry run (AS-14) — no transaction, no lock, changes nothing. */
export async function previewAllotmentChangeController(request: Request, response: Response, next: NextFunction): Promise<void> {
  const parsed = previewAllotmentSchema.safeParse(request.body);
  if (!parsed.success) return next(badRequest(parsed.error));
  const { roomTypeId, from, to, allotment } = parsed.data;

  try {
    const stock = await loadRoomTypeStock(roomTypeId);
    if (!stock) return next(notFound('Room type'));
    const nights = toNights(roomTypeId, from, to);
    const rows = await snapshotRoomDayState(pool, nights);
    const token = previewToken(rows);

    // null (removing the override) is checked against the resulting base value — the same
    // thing `findCommitmentConflicts` needs is a concrete proposed number, never a cap-less
    // "no limit" (AS-5: removal is not automatically safe).
    const proposed = allotment ?? stock.baseAllotment;
    const conflicts = await findCommitmentConflicts(pool, { roomTypeId, from, to: addDays(to, 1), proposedAllotment: Math.min(proposed, stock.physicalStock) });

    response.status(200).json({
      affected: rows.map((r) => ({ stayDate: r.stayDate, currentAllotment: r.allotment, currentPricePaise: r.pricePaise, currentIsBlackout: r.isBlackout })),
      conflicts,
      previewToken: token,
    });
  } catch (error) {
    next(error);
  }
}

export async function applyAllotmentOverrideController(request: Request, response: Response, next: NextFunction): Promise<void> {
  const parsed = applyAllotmentSchema.safeParse(request.body);
  if (!parsed.success) return next(badRequest(parsed.error));
  const actor = response.locals.principal as Principal;
  const { roomTypeId, from, to, allotment, previewToken: suppliedToken } = parsed.data;

  try {
    await withTransaction(async (client) => {
      const stock = await (async () => {
        const { rows } = await client.query<{ physical_stock: number }>(`SELECT physical_stock FROM room_types WHERE id = $1`, [roomTypeId]);
        return rows[0] ?? null;
      })();
      if (!stock) throw notFound('Room type');
      if (allotment > stock.physical_stock) throw new AppError('validation_failed', 'Allotment cannot exceed physical stock.');

      const nights = toNights(roomTypeId, from, to);
      // Same locks, same order, as a reservation (INV-3) — before re-snapshotting, so the
      // recomputed token reflects state no concurrent writer can still be mid-changing.
      await lockRoomDays(client, nights);

      const currentRows = await snapshotRoomDayState(client, nights);
      const recomputed = previewToken(currentRows);
      if (recomputed !== suppliedToken) {
        throw new AppError('stale_write', 'This range was edited since you last previewed it.');
      }

      const conflicts = await findCommitmentConflicts(client, { roomTypeId, from, to: addDays(to, 1), proposedAllotment: allotment });
      if (conflicts.length > 0) {
        throw new AppError('availability_conflict', 'That allotment would drop below existing commitments.', { conflicts });
      }

      for (const night of nights) {
        await client.query(
          `INSERT INTO room_day (room_type_id, stay_date, allotment, updated_by)
           VALUES ($1, $2, $3, $4)
           ON CONFLICT (room_type_id, stay_date) DO UPDATE SET allotment = $3, updated_at = now(), updated_by = $4`,
          [night.roomTypeId, night.stayDate, allotment, actor.userId],
        );
      }
      await recordAuditEvent(client, {
        actorUserId: actor.userId, actorRole: actor.role, action: 'allotment.update', targetKind: 'room_day',
        targetId: roomTypeId, before: currentRows, after: { from, to, allotment },
      });
    });
    response.status(200).json({ roomTypeId, from, to, allotment });
  } catch (error) {
    next(error);
  }
}

export async function removeAllotmentOverrideController(request: Request, response: Response, next: NextFunction): Promise<void> {
  const parsed = removeAllotmentSchema.safeParse(request.body);
  if (!parsed.success) return next(badRequest(parsed.error));
  const actor = response.locals.principal as Principal;
  const { roomTypeId, from, to, previewToken: suppliedToken } = parsed.data;

  try {
    await withTransaction(async (client) => {
      const { rows: stockRows } = await client.query<{ base_allotment: number }>(`SELECT base_allotment FROM room_types WHERE id = $1`, [roomTypeId]);
      const stock = stockRows[0];
      if (!stock) throw notFound('Room type');

      const nights = toNights(roomTypeId, from, to);
      await lockRoomDays(client, nights);

      const currentRows = await snapshotRoomDayState(client, nights);
      const recomputed = previewToken(currentRows);
      if (recomputed !== suppliedToken) {
        throw new AppError('stale_write', 'This range was edited since you last previewed it.');
      }

      // Validated against the RESULTING base value — removal is not automatically safe (AS-5).
      const conflicts = await findCommitmentConflicts(client, { roomTypeId, from, to: addDays(to, 1), proposedAllotment: stock.base_allotment });
      if (conflicts.length > 0) {
        throw new AppError('availability_conflict', 'Removing this override would drop below existing commitments.', { conflicts });
      }

      await client.query(
        `UPDATE room_day SET allotment = NULL, updated_at = now(), updated_by = $1 WHERE room_type_id = $2 AND stay_date = ANY($3)`,
        [actor.userId, roomTypeId, nights.map((n) => n.stayDate)],
      );
      await recordAuditEvent(client, {
        actorUserId: actor.userId, actorRole: actor.role, action: 'allotment.update', targetKind: 'room_day',
        targetId: roomTypeId, before: currentRows, after: { from, to, allotment: null },
      });
    });
    response.status(200).json({ roomTypeId, from, to, allotment: null });
  } catch (error) {
    next(error);
  }
}
