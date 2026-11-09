/**
 * SN-1..SN-7 (Docs/tests-phase1.md, 1G). No admin write routes exist yet (2F/2G) — "the GM
 * edits the rate" is simulated with a direct SQL write, same arrangement style the harness
 * already uses for `setRoomDay` (09-test-harness.md: "tests arrange state, they do not drive
 * the admin API to do it").
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'bun:test';
import type { AddressInfo } from 'node:net';
import { createApp } from '../src/app.ts';
import { pool } from '../src/db.ts';
import { requireTestDatabase, resetDatabase } from './helpers/db.ts';
import { createRoomType, setRoomDay, futureDate, publishResortInfo, createGuest, createPromo } from './helpers/factories.ts';

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

async function holdOneRoom(
  roomTypeId: string,
  checkIn: string,
  checkOut: string,
  promoCode?: string,
): Promise<{ bookingId: string; totalPaise: number }> {
  const guest = await createGuest();
  const quoteResponse = await post('/api/user/quotes', {
    checkIn,
    checkOut,
    rooms: [{ roomTypeId, adults: 1, children: 0 }],
    promoCode,
  });
  const { quoteId, totalPaise } = (await quoteResponse.json()) as { quoteId: string; totalPaise: number };
  const bookingResponse = await post(
    '/api/user/bookings',
    { quoteId, guestName: 'Snapshot Guest', guestEmail: `g-${crypto.randomUUID()}@example.com`, guestPhone: '9000000000' },
    guest.accessToken,
    crypto.randomUUID(),
  );
  const { bookingId } = (await bookingResponse.json()) as { bookingId: string };
  return { bookingId, totalPaise };
}

async function bookingTotals(bookingId: string) {
  const { rows } = await pool.query<{ room_paise: number; discount_paise: number; tax_paise: number; total_paise: number }>(
    `SELECT room_paise, discount_paise, tax_paise, total_paise FROM bookings WHERE id = $1`,
    [bookingId],
  );
  return rows[0]!;
}

describe('pricing.snapshot — 1G', () => {
  it('SN-1: raising the base price after confirmation never moves the booking total (INV-28)', async () => {
    const room = await createRoomType({ basePricePaise: 950000 });
    const checkIn = futureDate(10);
    const checkOut = futureDate(11);
    const { bookingId, totalPaise } = await holdOneRoom(room.id, checkIn, checkOut);
    await pool.query(`UPDATE bookings SET status = 'confirmed', confirmed_at = now() WHERE id = $1`, [bookingId]);

    await pool.query(`UPDATE room_types SET base_price_paise = 1500000 WHERE id = $1`, [room.id]);

    const after = await bookingTotals(bookingId);
    expect(after.total_paise).toBe(totalPaise);
  });

  it('SN-2: a festival override added over the booked dates afterwards never moves the total', async () => {
    const room = await createRoomType({ basePricePaise: 580000 });
    const checkIn = futureDate(10);
    const checkOut = futureDate(11);
    const { bookingId, totalPaise } = await holdOneRoom(room.id, checkIn, checkOut);
    await pool.query(`UPDATE bookings SET status = 'confirmed', confirmed_at = now() WHERE id = $1`, [bookingId]);

    await setRoomDay({ roomTypeId: room.id, stayDate: checkIn, pricePaise: 890000 });

    const after = await bookingTotals(bookingId);
    expect(after.total_paise).toBe(totalPaise);
  });

  it('SN-3: editing or deactivating the promo afterwards never moves the snapshotted discount', async () => {
    const room = await createRoomType({ basePricePaise: 500000 });
    const checkIn = futureDate(10);
    const checkOut = futureDate(11);
    await createPromo({ code: 'SNAP3', kind: 'fixed', value: 50000 });
    const { bookingId, totalPaise } = await holdOneRoom(room.id, checkIn, checkOut, 'SNAP3');
    await pool.query(`UPDATE bookings SET status = 'confirmed', confirmed_at = now() WHERE id = $1`, [bookingId]);
    const before = await bookingTotals(bookingId);
    expect(before.discount_paise).toBe(50000);

    await pool.query(`UPDATE promo_codes SET is_active = false, value = 1 WHERE code = 'SNAP3'`);

    const after = await bookingTotals(bookingId);
    expect(after.discount_paise).toBe(50000);
    expect(after.total_paise).toBe(totalPaise);
  });

  it('SN-4: a new tax_config version afterwards never moves the booking\'s amounts or version', async () => {
    const room = await createRoomType({ basePricePaise: 950000 }); // 18% bracket under v1
    const checkIn = futureDate(10);
    const checkOut = futureDate(11);
    const { bookingId, totalPaise } = await holdOneRoom(room.id, checkIn, checkOut);
    await pool.query(`UPDATE bookings SET status = 'confirmed', confirmed_at = now() WHERE id = $1`, [bookingId]);
    const before = await pool.query<{ tax_config_version: number }>(
      `SELECT tax_config_version FROM bookings WHERE id = $1`,
      [bookingId],
    );

    // resetDatabase() deliberately never truncates tax_config (it only re-seeds v1 if
    // missing) — so a version this test adds would otherwise leak into every test file that
    // runs afterward in the same process. Clean it up explicitly.
    try {
      await pool.query(
        `INSERT INTO tax_config (version, effective_from, threshold_paise, low_rate_bps, high_rate_bps, source_note)
         VALUES (2, now(), 1000000, 500, 1800, 'test: a new bracket')`,
      );

      const after = await bookingTotals(bookingId);
      const afterVersion = await pool.query<{ tax_config_version: number }>(
        `SELECT tax_config_version FROM bookings WHERE id = $1`,
        [bookingId],
      );
      expect(afterVersion.rows[0]!.tax_config_version).toBe(before.rows[0]!.tax_config_version);
      expect(after.total_paise).toBe(totalPaise);
    } finally {
      await pool.query(`DELETE FROM tax_config WHERE version = 2`);
    }
  });

  it('SN-5: a live, unpaid hold also keeps its accepted total when the base price changes mid-hold', async () => {
    const room = await createRoomType({ basePricePaise: 500000 });
    const checkIn = futureDate(10);
    const checkOut = futureDate(11);
    const { bookingId, totalPaise } = await holdOneRoom(room.id, checkIn, checkOut);
    const { rows } = await pool.query<{ status: string }>(`SELECT status FROM bookings WHERE id = $1`, [bookingId]);
    expect(rows[0]!.status).toBe('pending_payment'); // still just a hold, not confirmed

    await pool.query(`UPDATE room_types SET base_price_paise = 999999 WHERE id = $1`, [room.id]);

    const after = await bookingTotals(bookingId);
    expect(after.total_paise).toBe(totalPaise);
  });

  it('SN-6: renaming the room type afterwards leaves room_name_snapshot showing what was sold', async () => {
    const room = await createRoomType({ name: 'Original Name' });
    const checkIn = futureDate(10);
    const checkOut = futureDate(11);
    const { bookingId } = await holdOneRoom(room.id, checkIn, checkOut);

    await pool.query(`UPDATE room_types SET name = 'Renamed Suite' WHERE id = $1`, [room.id]);

    const { rows } = await pool.query<{ room_name_snapshot: string }>(
      `SELECT room_name_snapshot FROM booking_rooms WHERE booking_id = $1`,
      [bookingId],
    );
    expect(rows[0]!.room_name_snapshot).toBe('Original Name');
  });

  it('SN-7: reading a booking returns the snapshot, not a value recomputed against the current rate table', async () => {
    const room = await createRoomType({ basePricePaise: 500000 });
    const checkIn = futureDate(10);
    const checkOut = futureDate(11);
    const { bookingId, totalPaise } = await holdOneRoom(room.id, checkIn, checkOut);

    await pool.query(`UPDATE room_types SET base_price_paise = 9999999 WHERE id = $1`, [room.id]);

    const after = await bookingTotals(bookingId);
    expect(after.total_paise).toBe(totalPaise); // the booking's own value, never the live rate
  });
});
