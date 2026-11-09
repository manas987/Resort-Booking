import type { NextFunction, Request, Response } from 'express';
import { pool, withTransaction } from '../../../db.ts';
import type { Tx } from '../../../db.ts';
import { AppError, badRequest, notFound } from '../../../middleware/errors.ts';
import type { Principal } from '../../../core/tokens.ts';
import { nightsForStay, lockRoomDays, snapshotRoomDayState, readAvailability } from '../../../core/inventory.ts';
import type { NightRef } from '../../../core/pricing.ts';
import { previewToken } from '../../../core/previewToken.ts';
import { recordAuditEvent } from '../../../core/audit.ts';
import { readRatesQuerySchema, updateBasePriceSchema, previewRateSchema, applyRateSchema, removeRateSchema, rateHistoryQuerySchema } from './schema.ts';

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

export async function readRatesController(request: Request, response: Response, next: NextFunction): Promise<void> {
  const parsed = readRatesQuerySchema.safeParse(request.query);
  if (!parsed.success) return next(badRequest(parsed.error));
  const { roomTypeId, from, to } = parsed.data;

  try {
    const { rows } = await pool.query<{ base_price_paise: number }>(`SELECT base_price_paise FROM room_types WHERE id = $1`, [roomTypeId]);
    if (!rows[0]) return next(notFound('Room type'));
    const nights = toNights(roomTypeId, from, to);
    const overrides = await snapshotRoomDayState(pool, nights);
    const availability = await readAvailability(pool, { stay: { checkIn: from, checkOut: addDays(to, 1) }, roomTypeIds: [roomTypeId] });
    const isBlackoutByDate = new Map(availability.map((a) => [a.stayDate, a.isBlackout]));

    response.status(200).json({
      roomTypeId,
      basePricePaise: rows[0].base_price_paise,
      days: overrides.map((o) => ({
        stayDate: o.stayDate,
        pricePaise: o.pricePaise ?? rows[0]!.base_price_paise,
        hasOverride: o.pricePaise !== null,
        isBlackout: isBlackoutByDate.get(o.stayDate) ?? false,
      })),
    });
  } catch (error) {
    next(error);
  }
}

export async function updateBasePriceController(request: Request, response: Response, next: NextFunction): Promise<void> {
  const parsed = updateBasePriceSchema.safeParse(request.body);
  if (!parsed.success) return next(badRequest(parsed.error));
  const actor = response.locals.principal as Principal;
  const { roomTypeId } = request.params as { roomTypeId: string };

  try {
    await withTransaction(async (client) => {
      const { rows } = await client.query<{ base_price_paise: number }>(`SELECT base_price_paise FROM room_types WHERE id = $1 FOR UPDATE`, [roomTypeId]);
      if (!rows[0]) throw notFound('Room type');
      await client.query(`UPDATE room_types SET base_price_paise = $1 WHERE id = $2`, [parsed.data.basePricePaise, roomTypeId]);
      await recordAuditEvent(client, {
        actorUserId: actor.userId, actorRole: actor.role, action: 'rate.update', targetKind: 'room_type', targetId: roomTypeId,
        before: { basePricePaise: rows[0].base_price_paise }, after: { basePricePaise: parsed.data.basePricePaise },
      });
    });
    response.status(200).json({ roomTypeId, basePricePaise: parsed.data.basePricePaise });
  } catch (error) {
    next(error);
  }
}

/** Pure dry run — a price edit never checks commitments (INV-28: a sold/held total is a
 *  snapshot, unaffected by any later price change), so there is no `conflicts` source here
 *  beyond the empty array the shared response shape expects. */
export async function previewRateChangeController(request: Request, response: Response, next: NextFunction): Promise<void> {
  const parsed = previewRateSchema.safeParse(request.body);
  if (!parsed.success) return next(badRequest(parsed.error));
  const { roomTypeId, from, to } = parsed.data;

  try {
    if (!(await roomTypeExists(pool, roomTypeId))) return next(notFound('Room type'));
    const nights = toNights(roomTypeId, from, to);
    const rows = await snapshotRoomDayState(pool, nights);
    response.status(200).json({
      affected: rows.map((r) => ({ stayDate: r.stayDate, currentPricePaise: r.pricePaise, currentAllotment: r.allotment, currentIsBlackout: r.isBlackout })),
      conflicts: [],
      previewToken: previewToken(rows),
    });
  } catch (error) {
    next(error);
  }
}

export async function applyRateOverrideController(request: Request, response: Response, next: NextFunction): Promise<void> {
  const parsed = applyRateSchema.safeParse(request.body);
  if (!parsed.success) return next(badRequest(parsed.error));
  const actor = response.locals.principal as Principal;
  const { roomTypeId, from, to, pricePaise, previewToken: suppliedToken } = parsed.data;

  try {
    await withTransaction(async (client) => {
      if (!(await roomTypeExists(client, roomTypeId))) throw notFound('Room type');
      const nights = toNights(roomTypeId, from, to);
      await lockRoomDays(client, nights);

      const currentRows = await snapshotRoomDayState(client, nights);
      if (previewToken(currentRows) !== suppliedToken) {
        throw new AppError('stale_write', 'This range was edited since you last previewed it.');
      }

      for (const night of nights) {
        await client.query(
          `INSERT INTO room_day (room_type_id, stay_date, price_paise, updated_by)
           VALUES ($1, $2, $3, $4)
           ON CONFLICT (room_type_id, stay_date) DO UPDATE SET price_paise = $3, updated_at = now(), updated_by = $4`,
          [night.roomTypeId, night.stayDate, pricePaise, actor.userId],
        );
      }
      await recordAuditEvent(client, {
        actorUserId: actor.userId, actorRole: actor.role, action: 'rate.update', targetKind: 'room_day',
        targetId: roomTypeId, before: currentRows, after: { from, to, pricePaise },
      });
    });
    response.status(200).json({ roomTypeId, from, to, pricePaise });
  } catch (error) {
    next(error);
  }
}

export async function removeRateOverrideController(request: Request, response: Response, next: NextFunction): Promise<void> {
  const parsed = removeRateSchema.safeParse(request.body);
  if (!parsed.success) return next(badRequest(parsed.error));
  const actor = response.locals.principal as Principal;
  const { roomTypeId, from, to, previewToken: suppliedToken } = parsed.data;

  try {
    await withTransaction(async (client) => {
      if (!(await roomTypeExists(client, roomTypeId))) throw notFound('Room type');
      const nights = toNights(roomTypeId, from, to);
      await lockRoomDays(client, nights);

      const currentRows = await snapshotRoomDayState(client, nights);
      if (previewToken(currentRows) !== suppliedToken) {
        throw new AppError('stale_write', 'This range was edited since you last previewed it.');
      }

      await client.query(
        `UPDATE room_day SET price_paise = NULL, updated_at = now(), updated_by = $1 WHERE room_type_id = $2 AND stay_date = ANY($3)`,
        [actor.userId, roomTypeId, nights.map((n) => n.stayDate)],
      );
      await recordAuditEvent(client, {
        actorUserId: actor.userId, actorRole: actor.role, action: 'rate.update', targetKind: 'room_day',
        targetId: roomTypeId, before: currentRows, after: { from, to, pricePaise: null },
      });
    });
    response.status(200).json({ roomTypeId, from, to, pricePaise: null });
  } catch (error) {
    next(error);
  }
}

const HISTORY_ACTIONS: Record<string, string[]> = {
  rate: ['rate.update'],
  allotment: ['allotment.update'],
  blackout: ['blackout.set'],
};
const ALL_HISTORY_ACTIONS = ['rate.update', 'allotment.update', 'blackout.set'];

/** A SCOPED PROJECTION of `audit_events` (INV-39) — filtered to this room type, this window,
 *  and only rate/allotment/blackout actions. Never the general audit read `admin/audit`
 *  (owner-only) answers; a GM must never be able to page through unrelated audit rows by
 *  widening this query's filters. */
export async function readRateHistoryController(request: Request, response: Response, next: NextFunction): Promise<void> {
  const parsed = rateHistoryQuerySchema.safeParse(request.query);
  if (!parsed.success) return next(badRequest(parsed.error));
  const { roomTypeId, from, to, kind } = parsed.data;
  const actions = kind ? HISTORY_ACTIONS[kind]! : ALL_HISTORY_ACTIONS;

  try {
    const { rows } = await pool.query<{ actor_user_id: string | null; actor_role: string | null; action: string; before: unknown; after: unknown; created_at: string }>(
      `SELECT actor_user_id, actor_role, action, before, after, created_at
         FROM audit_events
        WHERE target_id = $1 AND action = ANY($2)
          AND created_at::date BETWEEN $3::date AND $4::date
        ORDER BY created_at DESC`,
      [roomTypeId, actions, from, to],
    );
    response.status(200).json({
      items: rows.map((r) => ({ actorUserId: r.actor_user_id, actorRole: r.actor_role, action: r.action, before: r.before, after: r.after, createdAt: r.created_at })),
    });
  } catch (error) {
    next(error);
  }
}
