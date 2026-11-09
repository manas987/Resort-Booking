/**
 * AT-1..AT-12 (Docs/tests-phase1.md, 1G — the graded hard part).
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'bun:test';
import type { AddressInfo } from 'node:net';
import { createApp } from '../src/app.ts';
import { pool } from '../src/db.ts';
import { requireTestDatabase, resetDatabase } from './helpers/db.ts';
import { createRoomType, setRoomDay, futureDate, publishResortInfo, createGuest } from './helpers/factories.ts';

requireTestDatabase();

let baseUrl: string;
let server: ReturnType<ReturnType<typeof createApp>['listen']>;

beforeAll(() => {
  const app = createApp();
  server = app.listen(0);
  const { port } = server.address() as AddressInfo;
  baseUrl = `http://127.0.0.1:${port}`;
});

afterAll(() => {
  server.close();
});

beforeEach(async () => {
  await resetDatabase();
  await publishResortInfo({ key: 'booking_terms', title: 'Terms', body: 'Standard booking terms.' });
});

async function post(path: string, body: unknown, accessToken?: string, idempotencyKey?: string): Promise<Response> {
  return fetch(`${baseUrl}${path}`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...(accessToken ? { authorization: `Bearer ${accessToken}` } : {}),
      ...(idempotencyKey ? { 'idempotency-key': idempotencyKey } : {}),
    },
    body: JSON.stringify(body),
  });
}
async function quoteFor(
  rooms: Array<{ roomTypeId: string; adults: number; children: number }>,
  checkIn: string,
  checkOut: string,
): Promise<string> {
  const response = await post('/api/user/quotes', { checkIn, checkOut, rooms });
  const body = (await response.json()) as { quoteId: string };
  return body.quoteId;
}

async function createHold(
  quoteId: string,
  accessToken: string,
): Promise<Response> {
  return post(
    '/api/user/bookings',
    { quoteId, guestName: 'Test Guest', guestEmail: 'guest@example.com', guestPhone: '9000000000' },
    accessToken,
    crypto.randomUUID(),
  );
}

describe('booking.atomicity — 1G', () => {
  it('AT-1: a multi-room, multi-night hold produces one booking, one reference, N rooms, N*nights nights', async () => {
    const estate = await createRoomType({ baseAllotment: 5, physicalStock: 5 });
    const villa = await createRoomType({ baseAllotment: 5, physicalStock: 5 });
    const checkIn = futureDate(10);
    const checkOut = futureDate(13); // 3 nights
    const guest = await createGuest();
    const quoteId = await quoteFor(
      [
        { roomTypeId: estate.id, adults: 1, children: 0 },
        { roomTypeId: estate.id, adults: 1, children: 0 },
        { roomTypeId: villa.id, adults: 1, children: 0 },
      ],
      checkIn,
      checkOut,
    );
    const response = await createHold(quoteId, guest.accessToken);
    expect(response.status).toBe(201);
    const { bookingId } = (await response.json()) as { bookingId: string };

    const { rows: bookings } = await pool.query(`SELECT check_in, check_out, hold_expires_at FROM bookings WHERE id = $1`, [bookingId]);
    expect(bookings).toHaveLength(1);
    const { rows: rooms } = await pool.query(`SELECT br.id FROM booking_rooms br WHERE br.booking_id = $1`, [bookingId]);
    expect(rooms).toHaveLength(3);
    const { rows: nights } = await pool.query(`SELECT id FROM booking_nights WHERE booking_id = $1`, [bookingId]);
    expect(nights).toHaveLength(9); // 3 rooms * 3 nights
  });

  it('AT-2: checkout is exclusive — a 14-16 stay produces exactly 2 nights per room', async () => {
    const room = await createRoomType();
    const checkIn = futureDate(14);
    const checkOut = futureDate(16);
    const guest = await createGuest();
    const quoteId = await quoteFor([{ roomTypeId: room.id, adults: 1, children: 0 }], checkIn, checkOut);
    const response = await createHold(quoteId, guest.accessToken);
    const { bookingId } = (await response.json()) as { bookingId: string };
    const { rows } = await pool.query(`SELECT stay_date::text FROM booking_nights WHERE booking_id = $1 ORDER BY stay_date`, [bookingId]);
    expect(rows).toHaveLength(2);
    expect(rows.map((r: { stay_date: string }) => r.stay_date)).toEqual([futureDate(14), futureDate(15)]);
  });

  it('AT-3: unavailable on one of three nights -> 409 naming it, zero rows written (INV-1)', async () => {
    const room = await createRoomType({ baseAllotment: 1, physicalStock: 1 });
    const checkIn = futureDate(10);
    const checkOut = futureDate(13);
    const blocked = futureDate(11);
    await setRoomDay({ roomTypeId: room.id, stayDate: blocked, allotment: 0 });
    const guest = await createGuest();
    const quoteId = await quoteFor([{ roomTypeId: room.id, adults: 1, children: 0 }], checkIn, checkOut);
    const response = await createHold(quoteId, guest.accessToken);
    expect(response.status).toBe(409);
    const body = (await response.json()) as { error: { details: { conflicts: Array<{ stayDate: string }> } } };
    expect(body.error.details.conflicts.map((c) => c.stayDate)).toContain(blocked);

    const counts = await Promise.all(
      ['bookings', 'booking_rooms', 'booking_nights'].map(async (table) => {
        const { rows } = await pool.query(`SELECT count(*)::int AS n FROM ${table}`);
        return rows[0].n;
      }),
    );
    expect(counts).toEqual([0, 0, 0]);
  });

  it('AT-5: occupancy over one room\'s max is 400, not satisfiable by another room\'s spare capacity', async () => {
    const small = await createRoomType({ maxAdults: 2, maxOccupancy: 3 });
    const checkIn = futureDate(10);
    const checkOut = futureDate(11);
    const response = await post('/api/user/quotes', {
      checkIn,
      checkOut,
      rooms: [{ roomTypeId: small.id, adults: 3, children: 0 }],
    });
    expect(response.status).toBe(400);
  });

  it('AT-6: one room over its own max is 400 even when another room has spare capacity', async () => {
    const tight = await createRoomType({ maxAdults: 2, maxOccupancy: 3 });
    const spacious = await createRoomType({ maxAdults: 4, maxChildren: 2, maxOccupancy: 6 });
    const response = await post('/api/user/quotes', {
      checkIn: futureDate(10),
      checkOut: futureDate(11),
      rooms: [
        { roomTypeId: tight.id, adults: 3, children: 0 }, // over tight's own max
        { roomTypeId: spacious.id, adults: 1, children: 0 }, // spare capacity here does not help
      ],
    });
    expect(response.status).toBe(400);
  });

  it('AT-9: a 15-night stay is 400 — max 14 nights per booking', async () => {
    const room = await createRoomType();
    const response = await post('/api/user/quotes', {
      checkIn: futureDate(10),
      checkOut: futureDate(25), // 15 nights
      rooms: [{ roomTypeId: room.id, adults: 1, children: 0 }],
    });
    expect(response.status).toBe(400);
  });

  it('AT-7: zero adults in a room is 400 — at least one adult per room', async () => {
    const room = await createRoomType();
    const response = await post('/api/user/quotes', {
      checkIn: futureDate(10),
      checkOut: futureDate(11),
      rooms: [{ roomTypeId: room.id, adults: 0, children: 2 }],
    });
    expect(response.status).toBe(400);
  });

  it('AT-8: 5 rooms requested is 400 — max 4 rooms per booking', async () => {
    const room = await createRoomType({ baseAllotment: 10, physicalStock: 10 });
    const response = await post('/api/user/quotes', {
      checkIn: futureDate(10),
      checkOut: futureDate(11),
      rooms: Array.from({ length: 5 }, () => ({ roomTypeId: room.id, adults: 1, children: 0 })),
    });
    expect(response.status).toBe(400);
  });

  it('AT-10: a check-in 400 days out is 400 — 365-day horizon', async () => {
    const room = await createRoomType();
    const response = await post('/api/user/quotes', {
      checkIn: futureDate(400),
      checkOut: futureDate(401),
      rooms: [{ roomTypeId: room.id, adults: 1, children: 0 }],
    });
    expect(response.status).toBe(400);
  });

  it('AT-11: checkout before check-in is 400 (the DB CHECK would also refuse it)', async () => {
    const room = await createRoomType();
    const response = await post('/api/user/quotes', {
      checkIn: futureDate(11),
      checkOut: futureDate(10),
      rooms: [{ roomTypeId: room.id, adults: 1, children: 0 }],
    });
    expect(response.status).toBe(400);
    await expect(
      pool.query(`INSERT INTO bookings (reference, guest_user_id, status, check_in, check_out,
        room_paise, discount_paise, tax_paise, total_paise, tax_config_version, terms_version,
        guest_name, guest_email, guest_phone)
        SELECT 'BK-TESTBAD1', id, 'payment_failed', $1, $2, 0, 0, 0, 0, 1, 0, 'x', 'x@x.com', '1'
        FROM users LIMIT 1`, [futureDate(11), futureDate(10)]),
    ).rejects.toThrow();
  });

  it('AT-12: a successful hold snapshots tax_config_version, terms_version and per-night prices', async () => {
    const room = await createRoomType({ basePricePaise: 950000 }); // 18% bracket
    const checkIn = futureDate(10);
    const checkOut = futureDate(11);
    const guest = await createGuest();
    const quoteId = await quoteFor([{ roomTypeId: room.id, adults: 1, children: 0 }], checkIn, checkOut);
    const response = await createHold(quoteId, guest.accessToken);
    const { bookingId } = (await response.json()) as { bookingId: string };

    const { rows } = await pool.query<{ tax_config_version: number; terms_version: number }>(
      `SELECT tax_config_version, terms_version FROM bookings WHERE id = $1`,
      [bookingId],
    );
    expect(rows[0]!.tax_config_version).toBe(1);
    expect(rows[0]!.terms_version).toBeGreaterThanOrEqual(1);
    const { rows: nights } = await pool.query<{ price_paise: number; tax_rate_bps: number }>(
      `SELECT price_paise, tax_rate_bps FROM booking_nights WHERE booking_id = $1`,
      [bookingId],
    );
    expect(nights[0]!.price_paise).toBe(950000);
    expect(nights[0]!.tax_rate_bps).toBe(1800);
  });

  it('inventory.oversell end-to-end: two genuinely concurrent /bookings calls for the last room — exactly one succeeds', async () => {
    const room = await createRoomType({ baseAllotment: 1, physicalStock: 1 });
    const checkIn = futureDate(10);
    const checkOut = futureDate(11);
    const guestA = await createGuest();
    const guestB = await createGuest();
    const quoteA = await quoteFor([{ roomTypeId: room.id, adults: 1, children: 0 }], checkIn, checkOut);
    const quoteB = await quoteFor([{ roomTypeId: room.id, adults: 1, children: 0 }], checkIn, checkOut);

    const keyA = crypto.randomUUID();
    const keyB = crypto.randomUUID();
    const results = await Promise.allSettled([
      post('/api/user/bookings', { quoteId: quoteA, guestName: 'A', guestEmail: 'a@example.com', guestPhone: '9000000001' }, guestA.accessToken, keyA),
      post('/api/user/bookings', { quoteId: quoteB, guestName: 'B', guestEmail: 'b@example.com', guestPhone: '9000000002' }, guestB.accessToken, keyB),
    ]);
    const statuses = await Promise.all(
      results.map((r) => (r.status === 'fulfilled' ? r.value.status : 0)),
    );
    expect(statuses.filter((s) => s === 201)).toHaveLength(1);
    expect(statuses.filter((s) => s === 409)).toHaveLength(1);

    const { rows } = await pool.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM booking_nights bn JOIN bookings b ON b.id = bn.booking_id
        WHERE bn.room_type_id = $1 AND bn.stay_date = $2
          AND (b.status = 'confirmed' OR (b.status = 'pending_payment' AND b.hold_expires_at > now()))`,
      [room.id, checkIn],
    );
    expect(rows[0]!.n).toBe(1);
  });
});
