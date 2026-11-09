/**
 * Committed inventory is always computed from booking_nights joined to bookings -- there is
 * no stored counter anywhere (INV-10). No Express types here (per `core/` rule).
 */
import type { Tx } from '../db.ts';
import { AppError } from '../middleware/errors.ts';
import type { StayRange, NightRef } from './pricing.ts';

export type Availability = {
  roomTypeId: string;
  stayDate: string;
  allotment: number;
  committed: number;
  remaining: number;
  isBlackout: boolean;
};

/** The canonical key for a (room type, date) pair. Never build this string inline. */
export function nightKey(roomTypeId: string, stayDate: string): string {
  return `${roomTypeId}|${stayDate}`;
}

function datesInRange(checkIn: string, checkOut: string): string[] {
  const dates: string[] = [];
  const cursor = new Date(`${checkIn}T00:00:00Z`);
  const end = new Date(`${checkOut}T00:00:00Z`);
  while (cursor < end) {
    dates.push(cursor.toISOString().slice(0, 10));
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return dates;
}

/** Expands a stay into its nights. Check-in inclusive, checkout exclusive (INV-2). */
export function nightsForStay(stay: StayRange, roomTypeIds: string[]): NightRef[] {
  const dates = datesInRange(stay.checkIn, stay.checkOut);
  const nights: NightRef[] = [];
  for (const roomTypeId of roomTypeIds) {
    for (const stayDate of dates) {
      nights.push({ roomTypeId, stayDate });
    }
  }
  return nights;
}

type RoomDayRow = {
  room_type_id: string;
  stay_date: string;
  price_paise: number | null;
  allotment: number | null;
  is_blackout: boolean;
};

async function roomDayOverrides(
  client: Tx,
  nights: NightRef[],
): Promise<Map<string, RoomDayRow>> {
  if (nights.length === 0) return new Map();
  const roomTypeIds = [...new Set(nights.map((n) => n.roomTypeId))];
  const dates = [...new Set(nights.map((n) => n.stayDate))];
  const { rows } = await client.query<RoomDayRow>(
    `SELECT room_type_id, stay_date, price_paise, allotment, is_blackout
       FROM room_day WHERE room_type_id = ANY($1) AND stay_date = ANY($2)`,
    [roomTypeIds, dates],
  );
  return new Map(rows.map((r) => [nightKey(r.room_type_id, r.stay_date), r]));
}

type RoomTypeStockRow = { id: string; physical_stock: number; base_allotment: number };

async function roomTypeStock(
  client: Tx,
  roomTypeIds: string[],
): Promise<Map<string, RoomTypeStockRow>> {
  if (roomTypeIds.length === 0) return new Map();
  const { rows } = await client.query<RoomTypeStockRow>(
    `SELECT id, physical_stock, base_allotment FROM room_types WHERE id = ANY($1)`,
    [roomTypeIds],
  );
  return new Map(rows.map((r) => [r.id, r]));
}

/** The availability expression shared by every caller (never re-derived) — confirmed bookings
 *  plus live (unexpired) holds, per room type per night (INV-1, INV-10). */
async function committedPerNight(
  client: Tx,
  nights: NightRef[],
): Promise<Map<string, number>> {
  if (nights.length === 0) return new Map();
  const roomTypeIds = [...new Set(nights.map((n) => n.roomTypeId))];
  const dates = [...new Set(nights.map((n) => n.stayDate))];
  const { rows } = await client.query<{ room_type_id: string; stay_date: string; n: number }>(
    `SELECT bn.room_type_id, bn.stay_date::text AS stay_date, count(*)::int AS n
       FROM booking_nights bn
       JOIN bookings b ON b.id = bn.booking_id
      WHERE bn.room_type_id = ANY($1) AND bn.stay_date = ANY($2)
        AND (b.status = 'confirmed'
             OR (b.status = 'pending_payment' AND b.hold_expires_at > now()))
      GROUP BY bn.room_type_id, bn.stay_date`,
    [roomTypeIds, dates],
  );
  return new Map(rows.map((r) => [nightKey(r.room_type_id, r.stay_date), r.n]));
}

function effectiveAllotmentFor(
  override: RoomDayRow | undefined,
  stock: RoomTypeStockRow,
): { allotment: number; isBlackout: boolean } {
  const isBlackout = override?.is_blackout ?? false;
  if (isBlackout) return { allotment: 0, isBlackout: true };
  const base = override?.allotment ?? stock.base_allotment;
  return { allotment: Math.min(base, stock.physical_stock), isBlackout: false };
}

/** Read-only availability. No locks. For display only — never authorises a booking (INV-1). */
export async function readAvailability(
  client: Tx,
  input: { stay: StayRange; roomTypeIds?: string[] },
): Promise<Availability[]> {
  const roomTypeIds =
    input.roomTypeIds ??
    (
      await client.query<{ id: string }>(`SELECT id FROM room_types WHERE is_active`)
    ).rows.map((r) => r.id);

  const nights = nightsForStay(input.stay, roomTypeIds);
  // Sequential: a single pg client cannot run concurrent queries (Tx is one connection).
  const overrides = await roomDayOverrides(client, nights);
  const stocks = await roomTypeStock(client, roomTypeIds);
  const committed = await committedPerNight(client, nights);

  return nights.map((night) => {
    const key = nightKey(night.roomTypeId, night.stayDate);
    const stock = stocks.get(night.roomTypeId)!;
    const { allotment, isBlackout } = effectiveAllotmentFor(overrides.get(key), stock);
    const committedCount = committed.get(key) ?? 0;
    return {
      roomTypeId: night.roomTypeId,
      stayDate: night.stayDate,
      allotment,
      committed: committedCount,
      remaining: Math.max(0, allotment - committedCount),
      isBlackout,
    };
  });
}

/** Materialises room_day rows, then locks them FOR UPDATE ordered by (room_type_id, stay_date).
 *  Fixed order prevents deadlock (INV-3). MUST be called inside withTransaction, before
 *  assertAvailable. */
export async function lockRoomDays(client: Tx, nights: NightRef[]): Promise<void> {
  if (nights.length === 0) return;
  const sorted = [...nights].sort(
    (a, b) => a.roomTypeId.localeCompare(b.roomTypeId) || a.stayDate.localeCompare(b.stayDate),
  );

  for (const night of sorted) {
    await client.query(
      `INSERT INTO room_day (room_type_id, stay_date) VALUES ($1, $2)
       ON CONFLICT (room_type_id, stay_date) DO NOTHING`,
      [night.roomTypeId, night.stayDate],
    );
  }

  await client.query(
    `SELECT rd.room_type_id, rd.stay_date
       FROM room_day rd
       JOIN unnest($1::uuid[], $2::date[]) AS wanted (room_type_id, stay_date)
         ON rd.room_type_id = wanted.room_type_id AND rd.stay_date = wanted.stay_date
      ORDER BY rd.room_type_id, rd.stay_date
      FOR UPDATE OF rd`,
    [sorted.map((n) => n.roomTypeId), sorted.map((n) => n.stayDate)],
  );
}

/** Rechecks AFTER locks are held. Counts confirmed + live holds from booking_nights. Throws
 *  AppError('availability_conflict', ..., { conflicts: NightRef[] }) naming every night that
 *  failed. Never partially succeeds (INV-1). */
export async function assertAvailable(
  client: Tx,
  input: { nights: NightRef[]; requestedPerNight: Map<string, number> },
): Promise<void> {
  const { nights, requestedPerNight } = input;
  if (nights.length === 0) return;

  const roomTypeIds = [...new Set(nights.map((n) => n.roomTypeId))];
  const overrides = await roomDayOverrides(client, nights);
  const stocks = await roomTypeStock(client, roomTypeIds);
  const committed = await committedPerNight(client, nights);

  const conflicts: NightRef[] = [];
  for (const night of nights) {
    const key = nightKey(night.roomTypeId, night.stayDate);
    const stock = stocks.get(night.roomTypeId)!;
    const { allotment } = effectiveAllotmentFor(overrides.get(key), stock);
    const committedCount = committed.get(key) ?? 0;
    const requested = requestedPerNight.get(key) ?? 0;
    if (committedCount + requested > allotment) {
      conflicts.push(night);
    }
  }

  if (conflicts.length > 0) {
    throw new AppError('availability_conflict', 'Requested rooms are no longer available.', {
      conflicts,
    });
  }
}

/** Effective allotment for admin validation: blackout -> 0, else
 *  least(override ?? base, physical_stock). */
export async function effectiveAllotment(client: Tx, night: NightRef): Promise<number> {
  const overrides = await roomDayOverrides(client, [night]);
  const stocks = await roomTypeStock(client, [night.roomTypeId]);
  const stock = stocks.get(night.roomTypeId);
  if (!stock) throw new AppError('validation_failed', `Unknown room type ${night.roomTypeId}.`);
  const { allotment } = effectiveAllotmentFor(overrides.get(nightKey(night.roomTypeId, night.stayDate)), stock);
  return allotment;
}

/** Used by admin writes: would this allotment leave existing commitments unhonoured? Returns
 *  the offending nights so the error can name every conflicting date (INV-9). */
export async function findCommitmentConflicts(
  client: Tx,
  input: {
    roomTypeId: string;
    from: string;
    to: string;
    proposedAllotment: number | null;
    blackout?: boolean;
  },
): Promise<NightRef[]> {
  const { roomTypeId, from, to, proposedAllotment, blackout } = input;
  const nights = nightsForStay({ checkIn: from, checkOut: to }, [roomTypeId]);
  const committed = await committedPerNight(client, nights);

  if (blackout) {
    return nights.filter((n) => (committed.get(nightKey(n.roomTypeId, n.stayDate)) ?? 0) > 0);
  }
  if (proposedAllotment === null) return [];

  const overrides = await roomDayOverrides(client, nights);
  const stocks = await roomTypeStock(client, [roomTypeId]);
  const stock = stocks.get(roomTypeId);
  if (!stock) throw new AppError('validation_failed', `Unknown room type ${roomTypeId}.`);

  return nights.filter((n) => {
    const key = nightKey(n.roomTypeId, n.stayDate);
    const isBlackout = overrides.get(key)?.is_blackout ?? false;
    const cap = isBlackout ? 0 : Math.min(proposedAllotment, stock.physical_stock);
    return (committed.get(key) ?? 0) > cap;
  });
}

/** Added 2F, not in the original sketch: the raw `room_day` override state for a set of
 *  nights, one entry per night, a non-existent row materialised as "no override"
 *  (`pricePaise: null, allotment: null, isBlackout: false`). This — not the *effective*
 *  merged-with-base value `readAvailability` computes — is what `previewToken` hashes:
 *  staleness means "the override row changed since preview," which this is the exact shape
 *  of (04-contracts.md's `previewToken` input). */
export async function snapshotRoomDayState(
  client: Tx,
  nights: NightRef[],
): Promise<Array<{ roomTypeId: string; stayDate: string; pricePaise: number | null; allotment: number | null; isBlackout: boolean }>> {
  const overrides = await roomDayOverrides(client, nights);
  return nights.map((night) => {
    const row = overrides.get(nightKey(night.roomTypeId, night.stayDate));
    return {
      roomTypeId: night.roomTypeId,
      stayDate: night.stayDate,
      pricePaise: row?.price_paise ?? null,
      allotment: row?.allotment ?? null,
      isBlackout: row?.is_blackout ?? false,
    };
  });
}
