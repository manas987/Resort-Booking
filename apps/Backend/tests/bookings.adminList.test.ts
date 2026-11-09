/**
 * `GET /api/admin/bookings` — the confirmation-date window and the `confirmedAt` field.
 *
 * Added when the console's Reports screen was wired to real data: its "booking value over time"
 * chart is explicitly by CONFIRMATION date, and the list endpoint previously exposed neither
 * `confirmed_at` nor a way to filter on it, so the only honest source was the CSV export (§21).
 * The window clause here is deliberately identical to that export's, so a figure read on a
 * report and a file exported for the same range cannot disagree.
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

type Listed = { items: Array<{ reference: string; confirmedAt: string | null; totalPaise: number }>; nextCursor: string | null };

async function confirmedOn(confirmedAt: string | null): Promise<{ id: string; reference: string }> {
  const roomType = await createRoomType({});
  const guest = await createGuest();
  const quote = await createQuote({
    guestUserId: guest.id,
    checkIn: futureDate(10),
    checkOut: futureDate(12),
    rooms: [{ roomTypeId: roomType.id, adults: 2, children: 0 }],
  });
  const booking = await createBooking({
    guestUserId: guest.id,
    quoteId: quote.id,
    status: confirmedAt ? 'confirmed' : 'pending_payment',
  });
  await pool.query(`UPDATE bookings SET confirmed_at = $1 WHERE id = $2`, [confirmedAt, booking.id]);
  return booking;
}

describe('admin bookings list — confirmation window', () => {
  it('AB-L1: returns confirmedAt on every row, null when unconfirmed', async () => {
    const staff = await createEmployee({ role: 'staff', team: 'reservations' });
    await confirmedOn('2025-06-02T10:00:00+05:30');
    await confirmedOn(null);

    const response = await get('/api/admin/bookings', staff.accessToken);
    expect(response.status).toBe(200);
    const body = (await response.json()) as Listed;
    expect(body.items).toHaveLength(2);
    expect(body.items.filter((b) => b.confirmedAt !== null)).toHaveLength(1);
    expect(body.items.filter((b) => b.confirmedAt === null)).toHaveLength(1);
  });

  it('AB-L2: the window filters on confirmation date, not stay date', async () => {
    const staff = await createEmployee({ role: 'staff', team: 'reservations' });
    // All three stay in the future; they differ only by when they were confirmed.
    await confirmedOn('2025-06-01T10:00:00+05:30');
    const wanted = await confirmedOn('2025-06-02T10:00:00+05:30');
    await confirmedOn('2025-06-03T10:00:00+05:30');

    const response = await get('/api/admin/bookings?confirmedFrom=2025-06-02&confirmedTo=2025-06-02', staff.accessToken);
    const body = (await response.json()) as Listed;
    expect(body.items).toHaveLength(1);
    expect(body.items[0]!.reference).toBe(wanted.reference);
  });

  it('AB-L3: the window resolves in Asia/Kolkata, not UTC', async () => {
    const staff = await createEmployee({ role: 'staff', team: 'reservations' });
    // 2025-06-02 00:30 IST is 2025-06-01 19:00 UTC. Asking for the 2nd must find it; asking
    // for the 1st must not. This is the case a naive `::date` on a UTC timestamp gets wrong.
    await confirmedOn('2025-06-02T00:30:00+05:30');

    const onTheSecond = (await (await get('/api/admin/bookings?confirmedFrom=2025-06-02&confirmedTo=2025-06-02', staff.accessToken)).json()) as Listed;
    const onTheFirst = (await (await get('/api/admin/bookings?confirmedFrom=2025-06-01&confirmedTo=2025-06-01', staff.accessToken)).json()) as Listed;
    expect(onTheSecond.items).toHaveLength(1);
    expect(onTheFirst.items).toHaveLength(0);
  });

  it('AB-L4: an unconfirmed booking is excluded whenever a window is supplied', async () => {
    const staff = await createEmployee({ role: 'staff', team: 'reservations' });
    await confirmedOn(null);

    const windowed = (await (await get('/api/admin/bookings?confirmedFrom=2000-01-01&confirmedTo=2099-12-31', staff.accessToken)).json()) as Listed;
    const unwindowed = (await (await get('/api/admin/bookings', staff.accessToken)).json()) as Listed;
    expect(windowed.items).toHaveLength(0);
    expect(unwindowed.items).toHaveLength(1);
  });

  it('AB-L6: a row carries its booked rooms, latest payment status and guest phone', async () => {
    const staff = await createEmployee({ role: 'staff', team: 'reservations' });
    const roomType = await createRoomType({ name: 'Garden Suite' });
    const guest = await createGuest();
    const quote = await createQuote({
      guestUserId: guest.id,
      checkIn: futureDate(10),
      checkOut: futureDate(12),
      // Two of the same type: the list shows "2 × Garden Suite", so they must group, not repeat.
      rooms: [
        { roomTypeId: roomType.id, adults: 2, children: 0 },
        { roomTypeId: roomType.id, adults: 1, children: 1 },
      ],
    });
    const booking = await createBooking({ guestUserId: guest.id, quoteId: quote.id, status: 'confirmed' });
    await pool.query(`UPDATE bookings SET guest_phone = '+919000000001' WHERE id = $1`, [booking.id]);
    // A decline followed by a success — the badge must show the LATEST attempt, not the first.
    await pool.query(
      `INSERT INTO payments (booking_id, attempt_no, status, amount_paise, provider_ref, failure_reason)
       VALUES ($1, 1, 'failed', 100, 'ref-1', 'card_declined'), ($1, 2, 'succeeded', 100, 'ref-2', NULL)`,
      [booking.id],
    );

    const body = (await (await get('/api/admin/bookings', staff.accessToken)).json()) as {
      items: Array<{ guestPhone: string; paymentStatus: string | null; rooms: Array<{ roomTypeId: string; roomName: string; quantity: number }> }>;
    };
    const row = body.items[0]!;
    expect(row.guestPhone).toBe('+919000000001');
    expect(row.paymentStatus).toBe('succeeded');
    expect(row.rooms).toEqual([{ roomTypeId: expect.any(String), roomName: 'Garden Suite', quantity: 2 }]);
  });

  it('AB-L5: an inverted window is rejected, not silently empty', async () => {
    const staff = await createEmployee({ role: 'staff', team: 'reservations' });
    const response = await get('/api/admin/bookings?confirmedFrom=2025-06-03&confirmedTo=2025-06-01', staff.accessToken);
    expect(response.status).toBe(400);
    const body = (await response.json()) as { error: { code: string } };
    expect(body.error.code).toBe('validation_failed');
  });
});
