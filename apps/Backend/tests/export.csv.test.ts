/**
 * EC-1..EC-12 (Docs/tests-phase2.md, 2E).
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'bun:test';
import type { AddressInfo } from 'node:net';
import { createApp } from '../src/app.ts';
import { pool } from '../src/db.ts';
import { requireTestDatabase, resetDatabase } from './helpers/db.ts';
import { createEmployee, createGuest, createRoomType, createQuote, createBooking, futureDate, publishResortInfo } from './helpers/factories.ts';

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

async function get(path: string, accessToken: string): Promise<Response> {
  return fetch(`${baseUrl}${path}`, { headers: { authorization: `Bearer ${accessToken}` } });
}

async function confirmedBooking(opts: { guestName?: string; confirmedAt?: string; checkIn?: string; checkOut?: string } = {}): Promise<{ id: string; reference: string }> {
  const roomType = await createRoomType({});
  const guest = await createGuest();
  const checkIn = opts.checkIn ?? futureDate(10);
  const checkOut = opts.checkOut ?? futureDate(12);
  const quote = await createQuote({ guestUserId: guest.id, checkIn, checkOut, rooms: [{ roomTypeId: roomType.id, adults: 2, children: 0 }] });
  const booking = await createBooking({ guestUserId: guest.id, quoteId: quote.id, status: 'confirmed' });
  if (opts.guestName) await pool.query(`UPDATE bookings SET guest_name = $1 WHERE id = $2`, [opts.guestName, booking.id]);
  if (opts.confirmedAt) await pool.query(`UPDATE bookings SET confirmed_at = $1 WHERE id = $2`, [opts.confirmedAt, booking.id]);
  return booking;
}

describe('export.csv — 2E', () => {
  it('EC-1: sales cannot export (INV-37)', async () => {
    const sales = await createEmployee({ role: 'staff', team: 'sales' });
    const response = await get('/api/admin/exports/bookings.csv?from=2020-01-01&to=2020-01-01', sales.accessToken);
    expect(response.status).toBe(403);
  });

  it('EC-2: reservations, gm and owner can each export', async () => {
    const reservations = await createEmployee({ role: 'staff', team: 'reservations' });
    const gm = await createEmployee({ role: 'gm' });
    const owner = await createEmployee({ role: 'owner' });
    for (const actor of [reservations, gm, owner]) {
      const response = await get('/api/admin/exports/bookings.csv?from=2020-01-01&to=2020-12-31', actor.accessToken);
      expect(response.status).toBe(200);
    }
  });

  it('EC-3b: confirmed_at is an ISO-8601 instant, not a JavaScript locale string', async () => {
    const reservations = await createEmployee({ role: 'staff', team: 'reservations' });
    await confirmedBooking({ confirmedAt: '2026-11-09T01:09:10+05:30' });

    const response = await get('/api/admin/exports/bookings.csv?from=2026-11-09&to=2026-11-09', reservations.accessToken);
    const csv = await response.text();
    const confirmedAt = csv.split('\r\n')[1]!.split(',').at(-1)!;
    expect(confirmedAt).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/);
    expect(csv).not.toContain('GMT');
    expect(csv).not.toContain('Standard Time');
  });

  it('EC-3/EC-5: filtered by confirmation date, not stay date', async () => {
    const reservations = await createEmployee({ role: 'staff', team: 'reservations' });
    const day1 = await confirmedBooking({ confirmedAt: '2025-06-01T10:00:00+05:30', guestName: 'Day One Guest' });
    const day2 = await confirmedBooking({ confirmedAt: '2025-06-02T10:00:00+05:30', guestName: 'Day Two Guest' });
    const day3 = await confirmedBooking({ confirmedAt: '2025-06-03T10:00:00+05:30', guestName: 'Day Three Guest' });
    // Stay dates are all in the future (confirmedBooking's default futureDate check-in) but
    // confirmation happened on the three days above — only day2 should be exported.
    void day1;
    void day3;

    const response = await get('/api/admin/exports/bookings.csv?from=2025-06-02&to=2025-06-02', reservations.accessToken);
    expect(response.status).toBe(200);
    const csv = await response.text();
    expect(csv).toContain('Day Two Guest');
    expect(csv).not.toContain('Day One Guest');
    expect(csv).not.toContain('Day Three Guest');
    void day2;
  });

  it('EC-4: same from and to is one day, inclusive', async () => {
    const reservations = await createEmployee({ role: 'staff', team: 'reservations' });
    await confirmedBooking({ confirmedAt: '2025-07-15T09:00:00+05:30', guestName: 'Same Day Guest' });
    const response = await get('/api/admin/exports/bookings.csv?from=2025-07-15&to=2025-07-15', reservations.accessToken);
    const csv = await response.text();
    expect(csv).toContain('Same Day Guest');
  });

  it('EC-6: a 400-day range is rejected — bounded range', async () => {
    const reservations = await createEmployee({ role: 'staff', team: 'reservations' });
    const response = await get('/api/admin/exports/bookings.csv?from=2024-01-01&to=2025-02-04', reservations.accessToken); // > 366 days
    expect(response.status).toBe(400);
  });

  it('EC-7: a formula-shaped guest name is emitted inert', async () => {
    const reservations = await createEmployee({ role: 'staff', team: 'reservations' });
    await confirmedBooking({ confirmedAt: '2025-08-01T09:00:00+05:30', guestName: '=SUM(A1:A9)' });
    const response = await get('/api/admin/exports/bookings.csv?from=2025-08-01&to=2025-08-01', reservations.accessToken);
    const csv = await response.text();
    expect(csv).toContain("'=SUM(A1:A9)");
  });

  it('EC-8: names starting +, -, @, tab or CR are all prefixed', async () => {
    const reservations = await createEmployee({ role: 'staff', team: 'reservations' });
    const names = ['+1234', '-evil', '@mention', '\tTabbed', '\rCarriage'];
    for (const [i, name] of names.entries()) {
      await confirmedBooking({ confirmedAt: `2025-09-0${i + 1}T09:00:00+05:30`, guestName: name });
    }
    const response = await get('/api/admin/exports/bookings.csv?from=2025-09-01&to=2025-09-05', reservations.accessToken);
    const csv = await response.text();
    for (const name of names) {
      expect(csv).toContain(`'${name}`);
    }
  });

  it('EC-9: a comma and a quote in the guest name are correctly quoted — no column shift', async () => {
    const reservations = await createEmployee({ role: 'staff', team: 'reservations' });
    await confirmedBooking({ confirmedAt: '2025-10-01T09:00:00+05:30', guestName: 'Doe, "Jane"' });
    const response = await get('/api/admin/exports/bookings.csv?from=2025-10-01&to=2025-10-01', reservations.accessToken);
    const csv = await response.text();
    const dataLine = csv.split('\r\n').find((l) => l.includes('Doe'))!;
    expect(dataLine).toContain('"Doe, ""Jane"""');
    // Field count check: splitting naively on the quoted field should still land on the
    // right number of top-level commas outside quotes.
    const fieldsOutsideQuotes = dataLine.replace(/"[^"]*"/g, 'X').split(',');
    expect(fieldsOutsideQuotes).toHaveLength(15); // HEADER has 15 columns
  });

  it('EC-10: one row per booking-room, reference repeated', async () => {
    const reservations = await createEmployee({ role: 'staff', team: 'reservations' });
    const roomType1 = await createRoomType({});
    const roomType2 = await createRoomType({});
    const guest = await createGuest();
    const checkIn = futureDate(10);
    const checkOut = futureDate(12);
    const quote = await createQuote({
      guestUserId: guest.id, checkIn, checkOut,
      rooms: [
        { roomTypeId: roomType1.id, adults: 2, children: 0 },
        { roomTypeId: roomType2.id, adults: 2, children: 0 },
      ],
    });
    const booking = await createBooking({ guestUserId: guest.id, quoteId: quote.id, status: 'confirmed' });
    await pool.query(`UPDATE bookings SET confirmed_at = '2025-11-01T09:00:00+05:30' WHERE id = $1`, [booking.id]);

    const response = await get('/api/admin/exports/bookings.csv?from=2025-11-01&to=2025-11-01', reservations.accessToken);
    const csv = await response.text();
    const rowsForBooking = csv.split('\r\n').filter((l) => l.startsWith(booking.reference));
    expect(rowsForBooking).toHaveLength(2);
  });

  it('EC-11: every export is audited with actor and the exact date range', async () => {
    const reservations = await createEmployee({ role: 'staff', team: 'reservations' });
    await get('/api/admin/exports/bookings.csv?from=2025-12-01&to=2025-12-31', reservations.accessToken);

    const { rows } = await pool.query<{ actor_user_id: string; after: { from: string; to: string } }>(
      `SELECT actor_user_id, after FROM audit_events WHERE action = 'export.bookings' ORDER BY created_at DESC LIMIT 1`,
    );
    expect(rows[0]!.actor_user_id).toBe(reservations.id);
    expect(rows[0]!.after.from).toBe('2025-12-01');
    expect(rows[0]!.after.to).toBe('2025-12-31');
  });

  it('EC-12: exported amounts are the purchased snapshot, not a recomputed price', async () => {
    const reservations = await createEmployee({ role: 'staff', team: 'reservations' });
    const booking = await confirmedBooking({ confirmedAt: '2026-01-01T09:00:00+05:30' });
    const { rows } = await pool.query<{ total_paise: number }>(`SELECT total_paise FROM bookings WHERE id = $1`, [booking.id]);

    const response = await get('/api/admin/exports/bookings.csv?from=2026-01-01&to=2026-01-01', reservations.accessToken);
    const csv = await response.text();
    expect(csv).toContain(String(rows[0]!.total_paise));
  });
});
