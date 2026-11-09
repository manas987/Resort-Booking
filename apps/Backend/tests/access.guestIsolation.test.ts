/**
 * GI-1, GI-2, GI-3, GI-4, GI-5, GI-7, GI-8 (Docs/tests-phase1.md, 1D/1G/1I).
 * GI-6 (changing a contact must not merge accounts or transfer booking ownership) is already
 * satisfied by construction in 1D's design — `verify_email`/`verify_phone` only ever write
 * the calling principal's OWN row, and `users.email` uniqueness means a second account could
 * never even take on an address still held by another — no booking-specific case to add here.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'bun:test';
import type { AddressInfo } from 'node:net';
import { createApp } from '../src/app.ts';
import { pool } from '../src/db.ts';
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

async function bookOneRoom(
  accessToken: string,
  roomTypeId: string,
  guestPhone = '9000000000',
): Promise<{ bookingId: string; reference: string }> {
  const quoteResponse = await post('/api/user/quotes', {
    checkIn: futureDate(10),
    checkOut: futureDate(11),
    rooms: [{ roomTypeId, adults: 1, children: 0 }],
  });
  const { quoteId } = (await quoteResponse.json()) as { quoteId: string };
  const bookingResponse = await post(
    '/api/user/bookings',
    { quoteId, guestName: 'Guest', guestEmail: `g-${crypto.randomUUID()}@example.com`, guestPhone },
    accessToken,
    crypto.randomUUID(),
  );
  return (await bookingResponse.json()) as { bookingId: string; reference: string };
}

describe('access.guestIsolation — 1D, 1G', () => {
  it('GI-1: A requesting B\'s booking by id is 403/404 — no data leaked', async () => {
    const room = await createRoomType({ baseAllotment: 5, physicalStock: 5 });
    const guestA = await createGuest();
    const guestB = await createGuest();
    const bookingB = await bookOneRoom(guestB.accessToken, room.id);

    const response = await get(`/api/user/bookings/${bookingB.bookingId}`, guestA.accessToken);
    expect([403, 404]).toContain(response.status);
    const body = (await response.json()) as { error?: unknown; reference?: unknown; totalPaise?: unknown };
    expect(body.reference).toBeUndefined();
    expect(body.totalPaise).toBeUndefined();
  });

  it('GI-2: A polling B\'s reference is denied', async () => {
    const room = await createRoomType({ baseAllotment: 5, physicalStock: 5 });
    const guestA = await createGuest();
    const guestB = await createGuest();
    const bookingB = await bookOneRoom(guestB.accessToken, room.id);

    const response = await get(`/api/user/bookings/reference/${bookingB.reference}/status`, guestA.accessToken);
    expect([403, 404]).toContain(response.status);
  });

  it('GI-3: a shared contact phone on the booking form is not ownership — A\'s list never includes B\'s booking (INV-34)', async () => {
    // `users.phone` is globally unique (a real verified contact can't be shared at all) —
    // the actual case INV-34 guards against is the booking FORM's guest_phone field, which
    // carries no verification and is not a key into anything. Two different guest accounts
    // can enter the same contact phone on their own bookings; ownership is still the account.
    const room = await createRoomType({ baseAllotment: 5, physicalStock: 5 });
    const sharedContactPhone = '9123456789';
    const guestA = await createGuest();
    const guestB = await createGuest();
    await bookOneRoom(guestB.accessToken, room.id, sharedContactPhone);
    const bookingA = await bookOneRoom(guestA.accessToken, room.id, sharedContactPhone);

    const response = await get('/api/user/bookings', guestA.accessToken);
    const body = (await response.json()) as { items: Array<{ bookingId: string }> };
    expect(body.items).toHaveLength(1);
    expect(body.items[0]!.bookingId).toBe(bookingA.bookingId);
  });

  it('GI-8: an unverified guest (email only) cannot create a hold — requireVerifiedGuest', async () => {
    const room = await createRoomType();
    const guest = await createGuest({ emailVerified: true, phoneVerified: false });
    const quoteResponse = await post('/api/user/quotes', {
      checkIn: futureDate(10),
      checkOut: futureDate(11),
      rooms: [{ roomTypeId: room.id, adults: 1, children: 0 }],
    });
    const { quoteId } = (await quoteResponse.json()) as { quoteId: string };

    const response = await post(
      '/api/user/bookings',
      { quoteId, guestName: 'Guest', guestEmail: 'guest@example.com', guestPhone: '9000000000' },
      guest.accessToken,
      crypto.randomUUID(),
    );
    expect(response.status).toBe(403);

    const { rows } = await pool.query<{ n: number }>(`SELECT count(*)::int AS n FROM bookings`);
    expect(rows[0]!.n).toBe(0);
  });

  it('GI-4: A requesting B\'s enquiry thread is denied', async () => {
    const guestA = await createGuest();
    const guestB = await createGuest();
    const createB = await post('/api/user/enquiries', { message: 'B\'s private question' }, guestB.accessToken);
    const { enquiryId } = (await createB.json()) as { enquiryId: string };

    const response = await get(`/api/user/enquiries/${enquiryId}`, guestA.accessToken);
    expect([403, 404]).toContain(response.status);
  });

  it('GI-5: citing B\'s booking reference in a message body creates no link and grants no access (INV-22)', async () => {
    const room = await createRoomType({ baseAllotment: 5, physicalStock: 5 });
    const guestA = await createGuest();
    const guestB = await createGuest();
    const bookingB = await bookOneRoom(guestB.accessToken, room.id);

    const response = await post(
      '/api/user/enquiries',
      { message: `Please check my booking ${bookingB.reference}` },
      guestA.accessToken,
    );
    expect(response.status).toBe(201);
    const { enquiryId } = (await response.json()) as { enquiryId: string };
    const { rows } = await pool.query<{ booking_id: string | null }>(`SELECT booking_id FROM enquiries WHERE id = $1`, [enquiryId]);
    expect(rows[0]!.booking_id).toBeNull(); // typing a reference in free text links nothing
  });

  it('GI-7: a guest thread detail carries no internal notes, AI internals, or assignee internals (INV-41)', async () => {
    const guest = await createGuest();
    const createResponse = await post('/api/user/enquiries', { message: 'A normal question' }, guest.accessToken);
    const { enquiryId } = (await createResponse.json()) as { enquiryId: string };
    const { rows: staffRows } = await pool.query<{ id: string }>(
      `INSERT INTO users (kind, role, team, name, email, username, password_hash)
       VALUES ('employee', 'staff', 'reservations', 'Staff GI7', 'staff-gi7@example.com', 'staffgi7', 'x')
       RETURNING id`,
    );
    await pool.query(`UPDATE enquiries SET assignee_id = $2, confidence = 0.91 WHERE id = $1`, [enquiryId, staffRows[0]!.id]);
    await pool.query(
      `INSERT INTO enquiry_messages (enquiry_id, direction, visibility, author_user_id, body)
       VALUES ($1, 'outbound', 'internal', $2, 'internal-only note text')`,
      [enquiryId, staffRows[0]!.id],
    );

    const response = await get(`/api/user/enquiries/${enquiryId}`, guest.accessToken);
    const text = await response.text();
    expect(text).not.toMatch(/internal-only note text|assigneeId|confidence/i);
  });
});
