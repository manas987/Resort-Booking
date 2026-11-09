/**
 * The headline test (Docs/tests-phase1.md, OS-1..OS-10). `core/booking.ts` (createBookingHold)
 * does not exist until 1G, so `attemptHold` below inserts the booking rows directly — the
 * same lock -> recheck -> insert sequence 1G's real function will later own (Docs/09-test-
 * harness.md: "the attempts must be inside open transactions at the same moment").
 */
import { describe, it, expect, beforeEach } from 'bun:test';
import type { Tx } from '../src/db.ts';
import { pool } from '../src/db.ts';
import { AppError } from '../src/middleware/errors.ts';
import { requireTestDatabase, resetDatabase } from './helpers/db.ts';
import { runConcurrently } from './helpers/concurrency.ts';
import {
  createRoomType,
  setRoomDay,
  futureDate,
  createGuestUserId,
  createQuote,
  createBooking,
  publishResortInfo,
} from './helpers/factories.ts';
import {
  lockRoomDays,
  assertAvailable,
  effectiveAllotment,
  readAvailability,
  nightKey,
  type Availability,
} from '../src/core/inventory.ts';
import type { NightRef } from '../src/core/pricing.ts';

requireTestDatabase();

beforeEach(async () => {
  await resetDatabase();
  await publishResortInfo({ key: 'booking_terms', title: 'Terms', body: 'Standard booking terms.' });
});

type RoomRequest = { roomTypeId: string; nights: string[] };

function addDays(date: string, n: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/** Models what createBookingHold (1G) will own: lock -> recheck -> insert, in one transaction
 *  on the caller's client. Returns 'conflict' on AppError('availability_conflict'); rethrows
 *  anything else. */
async function attemptHold(
  client: Tx,
  barrier: () => Promise<void>,
  guestUserId: string,
  rooms: RoomRequest[],
): Promise<'ok' | 'conflict'> {
  const allNights: NightRef[] = [];
  const seen = new Set<string>();
  for (const room of rooms) {
    for (const stayDate of room.nights) {
      const key = nightKey(room.roomTypeId, stayDate);
      if (!seen.has(key)) {
        seen.add(key);
        allNights.push({ roomTypeId: room.roomTypeId, stayDate });
      }
    }
  }
  const requestedPerNight = new Map<string, number>();
  for (const room of rooms) {
    for (const stayDate of room.nights) {
      const key = nightKey(room.roomTypeId, stayDate);
      requestedPerNight.set(key, (requestedPerNight.get(key) ?? 0) + 1);
    }
  }
  const dates = allNights.map((n) => n.stayDate).sort();
  const checkIn = dates[0]!;
  const checkOut = addDays(dates[dates.length - 1]!, 1);

  await client.query('BEGIN');
  try {
    await barrier();
    await lockRoomDays(client, allNights);
    await assertAvailable(client, { nights: allNights, requestedPerNight });

    const { rows: bookingRows } = await client.query<{ id: string }>(
      `INSERT INTO bookings
         (reference, guest_user_id, status, check_in, check_out, hold_expires_at,
          room_paise, discount_paise, tax_paise, total_paise, tax_config_version, terms_version,
          guest_name, guest_email, guest_phone)
       VALUES ('BK-' || substr(md5(random()::text), 1, 8), $1, 'pending_payment', $2, $3,
               now() + interval '10 minutes', 100, 0, 0, 100, 1, 0,
               'Test Guest', 'test-guest@example.com', '9999999999')
       RETURNING id`,
      [guestUserId, checkIn, checkOut],
    );
    const bookingId = bookingRows[0]!.id;

    for (const room of rooms) {
      const { rows: roomRows } = await client.query<{ id: string }>(
        `INSERT INTO booking_rooms (booking_id, room_type_id, room_name_snapshot, adults, children)
         VALUES ($1, $2, 'Test Room', 1, 0) RETURNING id`,
        [bookingId, room.roomTypeId],
      );
      const bookingRoomId = roomRows[0]!.id;
      for (const stayDate of room.nights) {
        await client.query(
          `INSERT INTO booking_nights
             (booking_id, booking_room_id, room_type_id, stay_date, price_paise, discount_paise,
              taxable_paise, tax_rate_bps, tax_paise)
           VALUES ($1, $2, $3, $4, 100, 0, 100, 0, 0)`,
          [bookingId, bookingRoomId, room.roomTypeId, stayDate],
        );
      }
    }

    await client.query('COMMIT');
    return 'ok';
  } catch (error) {
    await client.query('ROLLBACK');
    if (error instanceof AppError && error.code === 'availability_conflict') return 'conflict';
    throw error;
  }
}

async function liveCommittedCount(roomTypeId: string, stayDate: string): Promise<number> {
  const { rows } = await pool.query<{ n: number }>(
    `SELECT count(*)::int AS n
       FROM booking_nights bn
       JOIN bookings b ON b.id = bn.booking_id
      WHERE bn.room_type_id = $1 AND bn.stay_date = $2
        AND (b.status = 'confirmed'
             OR (b.status = 'pending_payment' AND b.hold_expires_at > now()))`,
    [roomTypeId, stayDate],
  );
  return rows[0]!.n;
}

describe('inventory.oversell — 1C', () => {
  it('OS-1: allotment 1, one night, two genuinely concurrent holds — exactly one succeeds', async () => {
    const room = await createRoomType({ baseAllotment: 1, physicalStock: 1 });
    const date = futureDate(10);
    const guestA = await createGuestUserId();
    const guestB = await createGuestUserId();

    const results = await runConcurrently([
      (client, barrier) => attemptHold(client, barrier, guestA, [{ roomTypeId: room.id, nights: [date] }]),
      (client, barrier) => attemptHold(client, barrier, guestB, [{ roomTypeId: room.id, nights: [date] }]),
    ]);

    const outcomes = results.map((r) => (r.status === 'ok' ? r.value : 'threw'));
    expect(outcomes.filter((o) => o === 'ok')).toHaveLength(1);
    expect(outcomes.filter((o) => o === 'conflict')).toHaveLength(1);
    expect(await liveCommittedCount(room.id, date)).toBe(1);
  });

  it('OS-2: allotment 3, one night, 10 concurrent single-room holds — exactly 3 succeed', async () => {
    const room = await createRoomType({ baseAllotment: 3, physicalStock: 3 });
    const date = futureDate(10);
    const guests = await Promise.all(Array.from({ length: 10 }, () => createGuestUserId()));

    const results = await runConcurrently(
      guests.map(
        (guestId) => (client: Tx, barrier: () => Promise<void>) =>
          attemptHold(client, barrier, guestId, [{ roomTypeId: room.id, nights: [date] }]),
      ),
    );

    const succeeded = results.filter((r) => r.status === 'ok' && r.value === 'ok');
    expect(succeeded).toHaveLength(3);
    expect(await liveCommittedCount(room.id, date)).toBe(3);
  });

  it('OS-3: allotment 2, one night, 2 concurrent 2-room requests — exactly one fully succeeds', async () => {
    const room = await createRoomType({ baseAllotment: 2, physicalStock: 2 });
    const date = futureDate(10);
    const guestA = await createGuestUserId();
    const guestB = await createGuestUserId();
    const twoRooms = (roomTypeId: string): RoomRequest[] => [
      { roomTypeId, nights: [date] },
      { roomTypeId, nights: [date] },
    ];

    const results = await runConcurrently([
      (client, barrier) => attemptHold(client, barrier, guestA, twoRooms(room.id)),
      (client, barrier) => attemptHold(client, barrier, guestB, twoRooms(room.id)),
    ]);

    const outcomes = results.map((r) => (r.status === 'ok' ? r.value : 'threw'));
    expect(outcomes.filter((o) => o === 'ok')).toHaveLength(1);
    expect(outcomes.filter((o) => o === 'conflict')).toHaveLength(1);
    expect(await liveCommittedCount(room.id, date)).toBe(2);
  });

  it('OS-4: the loser of a shared bottleneck room reserves no other room either (INV-1)', async () => {
    const estate = await createRoomType({ baseAllotment: 5, physicalStock: 5 });
    const villa = await createRoomType({ baseAllotment: 1, physicalStock: 1 });
    const date = futureDate(10);
    const guestA = await createGuestUserId();
    const guestB = await createGuestUserId();
    const bothRooms = (): RoomRequest[] => [
      { roomTypeId: estate.id, nights: [date] },
      { roomTypeId: villa.id, nights: [date] },
    ];

    const results = await runConcurrently([
      (client, barrier) => attemptHold(client, barrier, guestA, bothRooms()),
      (client, barrier) => attemptHold(client, barrier, guestB, bothRooms()),
    ]);

    const outcomes = results.map((r) => (r.status === 'ok' ? r.value : 'threw'));
    expect(outcomes.filter((o) => o === 'ok')).toHaveLength(1);
    expect(outcomes.filter((o) => o === 'conflict')).toHaveLength(1);
    // The loser's rolled-back transaction left no trace in either room's inventory.
    expect(await liveCommittedCount(estate.id, date)).toBe(1);
    expect(await liveCommittedCount(villa.id, date)).toBe(1);
  });

  it('OS-5: opposite lock order on the same rows — no deadlock (INV-3)', async () => {
    const roomA = await createRoomType({ baseAllotment: 5, physicalStock: 5 });
    const roomB = await createRoomType({ baseAllotment: 5, physicalStock: 5 });
    const day1 = futureDate(10);
    const day2 = futureDate(11);
    const guestA = await createGuestUserId();
    const guestB = await createGuestUserId();

    const results = await runConcurrently([
      (client, barrier) =>
        attemptHold(client, barrier, guestA, [
          { roomTypeId: roomA.id, nights: [day1] },
          { roomTypeId: roomB.id, nights: [day2] },
        ]),
      // Same two room-nights, but listed in the opposite order in the request.
      (client, barrier) =>
        attemptHold(client, barrier, guestB, [
          { roomTypeId: roomB.id, nights: [day2] },
          { roomTypeId: roomA.id, nights: [day1] },
        ]),
    ]);

    // No real contention (different rooms entirely sold once each) — both must succeed, and
    // neither call may have thrown a deadlock error (Postgres code 40P01).
    for (const result of results) {
      expect(result.status).toBe('ok');
    }
  });

  it('OS-6: a blackout on the middle night of a 3-night stay is rejected, naming that night', async () => {
    const room = await createRoomType({ baseAllotment: 5, physicalStock: 5 });
    const day1 = futureDate(10);
    const day2 = futureDate(11);
    const day3 = futureDate(12);
    await setRoomDay({ roomTypeId: room.id, stayDate: day2, isBlackout: true });

    const client = await pool.connect();
    const nights: NightRef[] = [
      { roomTypeId: room.id, stayDate: day1 },
      { roomTypeId: room.id, stayDate: day2 },
      { roomTypeId: room.id, stayDate: day3 },
    ];
    const requestedPerNight = new Map(nights.map((n) => [nightKey(n.roomTypeId, n.stayDate), 1]));

    await client.query('BEGIN');
    try {
      await lockRoomDays(client, nights);
      let thrown: AppError | undefined;
      try {
        await assertAvailable(client, { nights, requestedPerNight });
      } catch (error) {
        thrown = error as AppError;
      }
      expect(thrown).toBeInstanceOf(AppError);
      expect(thrown!.code).toBe('availability_conflict');
      const conflicts = (thrown!.details as { conflicts: NightRef[] }).conflicts;
      expect(conflicts).toHaveLength(1);
      expect(conflicts[0]).toEqual({ roomTypeId: room.id, stayDate: day2 });
    } finally {
      await client.query('ROLLBACK');
      client.release();
    }
  });

  it('OS-7: an allotment override of 0 rejects only that night', async () => {
    const room = await createRoomType({ baseAllotment: 5, physicalStock: 5 });
    const day1 = futureDate(10);
    const day2 = futureDate(11);
    await setRoomDay({ roomTypeId: room.id, stayDate: day2, allotment: 0 });

    const client = await pool.connect();
    const nights: NightRef[] = [
      { roomTypeId: room.id, stayDate: day1 },
      { roomTypeId: room.id, stayDate: day2 },
    ];
    const requestedPerNight = new Map(nights.map((n) => [nightKey(n.roomTypeId, n.stayDate), 1]));

    await client.query('BEGIN');
    try {
      await lockRoomDays(client, nights);
      let thrown: AppError | undefined;
      try {
        await assertAvailable(client, { nights, requestedPerNight });
      } catch (error) {
        thrown = error as AppError;
      }
      expect(thrown).toBeInstanceOf(AppError);
      const conflicts = (thrown!.details as { conflicts: NightRef[] }).conflicts;
      expect(conflicts).toHaveLength(1);
      expect(conflicts[0]).toEqual({ roomTypeId: room.id, stayDate: day2 });
    } finally {
      await client.query('ROLLBACK');
      client.release();
    }
  });

  it('OS-8: physical stock caps the effective allotment, even an admin override above it', async () => {
    // base_allotment <= physical_stock is a schema CHECK on room_types — only a per-date
    // override can exceed stock, and effectiveAllotment must still cap it.
    const room = await createRoomType({ baseAllotment: 5, physicalStock: 5 });
    const date = futureDate(10);
    await setRoomDay({ roomTypeId: room.id, stayDate: date, allotment: 10 });
    const allotment = await effectiveAllotment(pool, { roomTypeId: room.id, stayDate: date });
    expect(allotment).toBe(5);
  });

  it('OS-9: readAvailability shows 0 remaining on the last room, agreeing with assertAvailable', async () => {
    const room = await createRoomType({ baseAllotment: 1, physicalStock: 1 });
    const date = futureDate(10);
    const guest = await createGuestUserId();
    const quote = await createQuote({
      checkIn: date,
      checkOut: futureDate(11),
      rooms: [{ roomTypeId: room.id, adults: 1, children: 0 }],
    });
    await createBooking({ guestUserId: guest, quoteId: quote.id, status: 'pending_payment' });

    const [availability] = await readAvailability(pool, {
      stay: { checkIn: date, checkOut: futureDate(11) },
      roomTypeIds: [room.id],
    });
    expect((availability as Availability).remaining).toBe(0);

    const lockingClient = await pool.connect();
    await lockingClient.query('BEGIN');
    try {
      const nights: NightRef[] = [{ roomTypeId: room.id, stayDate: date }];
      await lockRoomDays(lockingClient, nights);
      await expect(
        assertAvailable(lockingClient, {
          nights,
          requestedPerNight: new Map([[nightKey(room.id, date), 1]]),
        }),
      ).rejects.toThrow();
    } finally {
      await lockingClient.query('ROLLBACK');
      lockingClient.release();
    }
  });

  it('OS-10: an expired hold frees inventory instantly, with no worker run (INV-10)', async () => {
    const room = await createRoomType({ baseAllotment: 1, physicalStock: 1 });
    const date = futureDate(10);
    const guestA = await createGuestUserId();
    const guestB = await createGuestUserId();
    const quote = await createQuote({
      checkIn: date,
      checkOut: futureDate(11),
      rooms: [{ roomTypeId: room.id, adults: 1, children: 0 }],
    });
    await createBooking({
      guestUserId: guestA,
      quoteId: quote.id,
      status: 'pending_payment',
      holdExpiresAt: 'past',
    });

    const outcome = await pool.connect().then(async (client) => {
      try {
        return await attemptHold(client, async () => {}, guestB, [
          { roomTypeId: room.id, nights: [date] },
        ]);
      } finally {
        client.release();
      }
    });
    expect(outcome).toBe('ok');
    expect(await liveCommittedCount(room.id, date)).toBe(1);
  });
});
