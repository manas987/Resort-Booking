/**
 * RB-1..RB-7 (Docs/tests-phase1.md, 1G).
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'bun:test';
import type { AddressInfo } from 'node:net';
import { createApp } from '../src/app.ts';
import { pool, withTransaction, withSavepoint, PG, isPgError } from '../src/db.ts';
import { requireTestDatabase, resetDatabase } from './helpers/db.ts';
import { createRoomType, futureDate, publishResortInfo, createGuest } from './helpers/factories.ts';

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

async function get(path: string, accessToken: string): Promise<Response> {
  return fetch(`${baseUrl}${path}`, { headers: { authorization: `Bearer ${accessToken}` } });
}

async function quoteFor(roomTypeId: string, checkIn: string, checkOut: string): Promise<string> {
  const response = await post('/api/user/quotes', {
    checkIn,
    checkOut,
    rooms: [{ roomTypeId, adults: 1, children: 0 }],
  });
  const body = (await response.json()) as { quoteId: string };
  return body.quoteId;
}

async function emptyCounts(): Promise<number[]> {
  return Promise.all(
    ['bookings', 'booking_rooms', 'booking_nights'].map(async (table) => {
      const { rows } = await pool.query<{ n: number }>(`SELECT count(*)::int AS n FROM ${table}`);
      return rows[0]!.n;
    }),
  );
}

describe('booking.rollback — 1G', () => {
  it('RB-1: a failure after booking_rooms, before booking_nights, leaves nothing orphaned', async () => {
    await pool.query(`
      CREATE OR REPLACE FUNCTION test_fail_nights() RETURNS trigger LANGUAGE plpgsql AS
      $fn$ BEGIN RAISE EXCEPTION 'injected failure'; END $fn$;
      CREATE TRIGGER test_fail_nights BEFORE INSERT ON booking_nights
        FOR EACH ROW EXECUTE FUNCTION test_fail_nights();
    `);
    try {
      const room = await createRoomType();
      const guest = await createGuest();
      const quoteId = await quoteFor(room.id, futureDate(10), futureDate(11));
      const response = await post(
        '/api/user/bookings',
        { quoteId, guestName: 'RB1', guestEmail: 'rb1@example.com', guestPhone: '9000000000' },
        guest.accessToken,
        crypto.randomUUID(),
      );
      expect(response.status).toBe(500); // the injected failure surfaces as internal_error
      expect(await emptyCounts()).toEqual([0, 0, 0]);
    } finally {
      await pool.query('DROP TRIGGER test_fail_nights ON booking_nights');
    }
  });

  it('RB-2: the expire_holds job and the booking are both present, or both absent — never one without the other (INV-23)', async () => {
    const room = await createRoomType();
    const guest = await createGuest();
    const quoteId = await quoteFor(room.id, futureDate(10), futureDate(11));
    const response = await post(
      '/api/user/bookings',
      { quoteId, guestName: 'RB2', guestEmail: 'rb2@example.com', guestPhone: '9000000000' },
      guest.accessToken,
      crypto.randomUUID(),
    );
    expect(response.status).toBe(201);
    const { bookingId } = (await response.json()) as { bookingId: string };

    const { rows: jobs } = await pool.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM jobs WHERE type = 'expire_holds' AND dedupe_key = $1`,
      [`expire_holds:${bookingId}`],
    );
    expect(jobs[0]!.n).toBe(1);
  });

  it('RB-3: a quote expired by one second is 410 quote_expired, no booking', async () => {
    const room = await createRoomType();
    const guest = await createGuest();
    const quoteId = await quoteFor(room.id, futureDate(10), futureDate(11));
    await pool.query(`UPDATE quotes SET expires_at = now() - interval '1 second' WHERE id = $1`, [quoteId]);

    const response = await post(
      '/api/user/bookings',
      { quoteId, guestName: 'RB3', guestEmail: 'rb3@example.com', guestPhone: '9000000000' },
      guest.accessToken,
      crypto.randomUUID(),
    );
    expect(response.status).toBe(410);
    expect(await emptyCounts()).toEqual([0, 0, 0]);
  });

  it('RB-4: a quote belonging to another guest is 404, no booking (INV-34)', async () => {
    const room = await createRoomType();
    const owner = await createGuest();
    const stranger = await createGuest();
    const quoteId = await quoteFor(room.id, futureDate(10), futureDate(11));
    // Claim ownership for `owner` first (createQuote with no auth leaves it NULL — stamp it).
    await pool.query(`UPDATE quotes SET guest_user_id = $1 WHERE id = $2`, [owner.id, quoteId]);

    const response = await post(
      '/api/user/bookings',
      { quoteId, guestName: 'RB4', guestEmail: 'rb4@example.com', guestPhone: '9000000000' },
      stranger.accessToken,
      crypto.randomUUID(),
    );
    expect(response.status).toBe(404);
    expect(await emptyCounts()).toEqual([0, 0, 0]);
  });

  it('RB-5: a base price changed between quote and hold is 422 price_changed, carrying a fresh quote', async () => {
    const room = await createRoomType({ basePricePaise: 500000 });
    const guest = await createGuest();
    const quoteId = await quoteFor(room.id, futureDate(10), futureDate(11));
    await pool.query(`UPDATE room_types SET base_price_paise = 600000 WHERE id = $1`, [room.id]);

    const response = await post(
      '/api/user/bookings',
      { quoteId, guestName: 'RB5', guestEmail: 'rb5@example.com', guestPhone: '9000000000' },
      guest.accessToken,
      crypto.randomUUID(),
    );
    expect(response.status).toBe(422);
    const body = (await response.json()) as { error: { code: string; details: { quoteId: string; totalPaise: number } } };
    expect(body.error.code).toBe('price_changed');
    expect(body.error.details.quoteId).toBeTruthy();
    expect(body.error.details.quoteId).not.toBe(quoteId);
    // The fresh quote must exist, not merely be named. It is written on its own connection
    // after the hold transaction has rolled back; written inside that transaction it was
    // rolled back with it, and this 422 pointed at a quote `GET /quotes/:id` answered 404
    // for — the "confirm the new total" step (§8D) could never be completed.
    const fresh = await get(`/api/user/quotes/${body.error.details.quoteId}`, guest.accessToken);
    expect(fresh.status).toBe(200);
    const freshBody = (await fresh.json()) as { totalPaise: number };
    expect(freshBody.totalPaise).toBe(body.error.details.totalPaise);
    expect(await emptyCounts()).toEqual([0, 0, 0]);
  });

  it('RB-8: one quote converts to at most one live booking, even with a fresh Idempotency-Key', async () => {
    // A double-click that regenerates its key is a *different* request to
    // middleware/idempotency.ts, so the key cannot catch it. Before the `FOR UPDATE` +
    // single-use check in createBookingHold, both calls returned 201 and the guest held the
    // same stay twice against one intent.
    const room = await createRoomType({ baseAllotment: 5, physicalStock: 5 });
    const guest = await createGuest();
    const quoteId = await quoteFor(room.id, futureDate(10), futureDate(11));
    const body = { quoteId, guestName: 'RB8', guestEmail: 'rb8@example.com', guestPhone: '9000000000' };

    const first = await post('/api/user/bookings', body, guest.accessToken, crypto.randomUUID());
    const second = await post('/api/user/bookings', body, guest.accessToken, crypto.randomUUID());

    expect(first.status).toBe(201);
    expect(second.status).toBe(409);
    const refused = (await second.json()) as { error: { code: string; details: { reference: string } } };
    expect(refused.error.code).toBe('quote_already_booked');
    const { reference } = (await first.json()) as { reference: string };
    expect(refused.error.details.reference).toBe(reference);

    const { rows } = await pool.query<{ n: number }>(`SELECT count(*)::int AS n FROM bookings`);
    expect(rows[0]!.n).toBe(1);
  });

  it('RB-9: two genuinely parallel holds on one quote — exactly one wins', async () => {
    // Sequential calls pass against a read-then-write check; these must overlap. The quote
    // row lock is what serialises them.
    const room = await createRoomType({ baseAllotment: 5, physicalStock: 5 });
    const guest = await createGuest();
    const quoteId = await quoteFor(room.id, futureDate(10), futureDate(11));
    const body = { quoteId, guestName: 'RB9', guestEmail: 'rb9@example.com', guestPhone: '9000000000' };

    const results = await Promise.all([
      post('/api/user/bookings', body, guest.accessToken, crypto.randomUUID()),
      post('/api/user/bookings', body, guest.accessToken, crypto.randomUUID()),
    ]);
    const statuses = results.map((r) => r.status);
    expect(statuses.filter((s) => s === 201)).toHaveLength(1);
    expect(statuses.filter((s) => s === 409)).toHaveLength(1);

    const { rows } = await pool.query<{ n: number }>(`SELECT count(*)::int AS n FROM bookings`);
    expect(rows[0]!.n).toBe(1);
  });

  it('RB-6: a rolled-back hold leaks no connection — the pool returns to idle', async () => {
    const room = await createRoomType();
    const guest = await createGuest();
    const quoteId = await quoteFor(room.id, futureDate(10), futureDate(11));
    await pool.query(`UPDATE quotes SET expires_at = now() - interval '1 second' WHERE id = $1`, [quoteId]);

    await post(
      '/api/user/bookings',
      { quoteId, guestName: 'RB6', guestEmail: 'rb6@example.com', guestPhone: '9000000000' },
      guest.accessToken,
      crypto.randomUUID(),
    );
    // Give the pool a tick to release, then every checked-out client must be idle again.
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(pool.waitingCount).toBe(0);
    expect(pool.idleCount).toBeGreaterThan(0);
    expect(pool.idleCount).toBe(pool.totalCount);
  });

  it('RB-7: a caught unique violation leaves the transaction usable, so a reference retry can succeed', async () => {
    const room = await createRoomType({});
    // The retry-on-collision loops in createBookingHold and the enquiry controllers depend on
    // this: in Postgres a failed statement aborts the whole transaction unless it is rolled
    // back to a savepoint, so without withSavepoint the second attempt would fail 25P02.
    const survived = await withTransaction(async (client) => {
      let caught = false;
      try {
        await withSavepoint(client, () =>
          client.query(
            `INSERT INTO room_types
               (slug, name, summary, description, max_adults, max_children, max_occupancy,
                physical_stock, base_price_paise, base_allotment)
             VALUES ($1, 'dup', '', '', 2, 0, 2, 1, 100, 1)`,
            [room.slug],
          ),
        );
      } catch (error) {
        caught = isPgError(error, PG.UNIQUE_VIOLATION);
        if (!caught) throw error;
      }
      const { rows } = await client.query<{ n: number }>(`SELECT count(*)::int AS n FROM room_types`);
      return { caught, n: rows[0]!.n };
    });

    expect(survived.caught).toBe(true);
    expect(survived.n).toBe(1);
  });
});
