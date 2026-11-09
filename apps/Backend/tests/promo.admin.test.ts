/**
 * PA-1..PA-8 (Docs/tests-phase2.md, 2G).
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'bun:test';
import type { AddressInfo } from 'node:net';
import { createApp } from '../src/app.ts';
import { pool } from '../src/db.ts';
import { requireTestDatabase, resetDatabase } from './helpers/db.ts';
import { createEmployee, createGuest, createRoomType, createPromo, futureDate, publishResortInfo } from './helpers/factories.ts';
import { processBatch } from '../src/jobs/worker.ts';

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
async function patch(path: string, body: unknown, accessToken: string): Promise<Response> {
  return fetch(`${baseUrl}${path}`, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${accessToken}` },
    body: JSON.stringify(body),
  });
}
async function get(path: string, accessToken: string): Promise<Response> {
  return fetch(`${baseUrl}${path}`, { headers: { authorization: `Bearer ${accessToken}` } });
}

/** A real confirmed booking that consumed a promo, via the actual guest flow. */
async function confirmedBookingWithPromo(roomTypeId: string, promoCode: string): Promise<{ bookingId: string; discountPaise: number; totalPaise: number }> {
  const checkIn = futureDate(10);
  const checkOut = futureDate(12);
  const quoteResponse = await post('/api/user/quotes', { checkIn, checkOut, rooms: [{ roomTypeId, adults: 1, children: 0 }], promoCode });
  const quote = (await quoteResponse.json()) as { quoteId: string };
  const guest = await createGuest();
  const bookingResponse = await post(
    '/api/user/bookings',
    { quoteId: quote.quoteId, guestName: 'Promo Guest', guestEmail: `g-${crypto.randomUUID()}@example.test`, guestPhone: '9000000000' },
    guest.accessToken,
    crypto.randomUUID(),
  );
  const { bookingId } = (await bookingResponse.json()) as { bookingId: string };
  const payResponse = await post(`/api/user/payments/${bookingId}/attempts`, {}, guest.accessToken, crypto.randomUUID());
  expect(payResponse.status).toBe(201);
  await processBatch('promo-admin-worker');

  const { rows } = await pool.query<{ discount_paise: number; total_paise: number; status: string }>(
    `SELECT discount_paise, total_paise, status FROM bookings WHERE id = $1`,
    [bookingId],
  );
  expect(rows[0]!.status).toBe('confirmed');
  return { bookingId, discountPaise: rows[0]!.discount_paise, totalPaise: rows[0]!.total_paise };
}

describe('promo.admin — 2G', () => {
  it('PA-1: changing a code\'s percentage never changes an already-sold booking\'s discount or total (INV-28)', async () => {
    const gm = await createEmployee({ role: 'gm' });
    const room = await createRoomType({ basePricePaise: 500000 });
    const promo = await createPromo({ code: 'PA1TEST', kind: 'percent', value: 1000 }); // 10%
    const { bookingId, discountPaise, totalPaise } = await confirmedBookingWithPromo(room.id, 'PA1TEST');

    const response = await patch(`/api/admin/promos/${promo.id}`, { value: 5000 }, gm.accessToken); // 50%
    expect(response.status).toBe(200);

    const { rows } = await pool.query<{ discount_paise: number; total_paise: number }>(`SELECT discount_paise, total_paise FROM bookings WHERE id = $1`, [bookingId]);
    expect(rows[0]!.discount_paise).toBe(discountPaise);
    expect(rows[0]!.total_paise).toBe(totalPaise);
  });

  it('PA-2: deactivating a code leaves the booking unchanged and still valid', async () => {
    const gm = await createEmployee({ role: 'gm' });
    const room = await createRoomType({ basePricePaise: 500000 });
    const promo = await createPromo({ code: 'PA2TEST', kind: 'fixed', value: 50000 });
    const { bookingId, discountPaise, totalPaise } = await confirmedBookingWithPromo(room.id, 'PA2TEST');

    const response = await patch(`/api/admin/promos/${promo.id}`, { isActive: false }, gm.accessToken);
    expect(response.status).toBe(200);

    const { rows } = await pool.query<{ discount_paise: number; total_paise: number; status: string }>(
      `SELECT discount_paise, total_paise, status FROM bookings WHERE id = $1`,
      [bookingId],
    );
    expect(rows[0]!.status).toBe('confirmed');
    expect(rows[0]!.discount_paise).toBe(discountPaise);
    expect(rows[0]!.total_paise).toBe(totalPaise);
  });

  it('PA-3: a new hold against an already-exhausted code is refused', async () => {
    const room = await createRoomType({ basePricePaise: 500000, baseAllotment: 10, physicalStock: 10 });
    await createPromo({ code: 'PA3TEST', kind: 'fixed', value: 10000, maxUses: 2 });
    await confirmedBookingWithPromo(room.id, 'PA3TEST');
    await confirmedBookingWithPromo(room.id, 'PA3TEST');

    const checkIn = futureDate(20);
    const checkOut = futureDate(22);
    const quoteResponse = await post('/api/user/quotes', { checkIn, checkOut, rooms: [{ roomTypeId: room.id, adults: 1, children: 0 }], promoCode: 'PA3TEST' });
    const quote = (await quoteResponse.json()) as { quoteId: string };
    const guest = await createGuest();
    const bookingResponse = await post(
      '/api/user/bookings',
      { quoteId: quote.quoteId, guestName: 'Third Guest', guestEmail: 'third@example.test', guestPhone: '9000000003' },
      guest.accessToken,
      crypto.randomUUID(),
    );
    expect(bookingResponse.status).toBe(409);
    const body = await bookingResponse.json();
    expect((body as { error: { code: string } }).error.code).toBe('promo_exhausted');
  });

  it('PA-4: a percent value of 10001 bps is rejected', async () => {
    const gm = await createEmployee({ role: 'gm' });
    const response = await post('/api/admin/promos', { code: 'PA4TEST', kind: 'percent', value: 10001 }, gm.accessToken);
    expect(response.status).toBe(400);
  });

  it('PA-5: ends_at before starts_at is rejected', async () => {
    const gm = await createEmployee({ role: 'gm' });
    const response = await post(
      '/api/admin/promos',
      { code: 'PA5TEST', kind: 'fixed', value: 10000, startsAt: '2026-06-01T00:00:00.000Z', endsAt: '2026-05-01T00:00:00.000Z' },
      gm.accessToken,
    );
    expect(response.status).toBe(400);
  });

  it('PA-6: a duplicate code differing only in case is rejected', async () => {
    const gm = await createEmployee({ role: 'gm' });
    const first = await post('/api/admin/promos', { code: 'SummerSale', kind: 'fixed', value: 10000 }, gm.accessToken);
    expect(first.status).toBe(201);
    const second = await post('/api/admin/promos', { code: 'summersale', kind: 'fixed', value: 20000 }, gm.accessToken);
    expect(second.status).toBe(400);
  });

  it('PA-7: any promo change is audited with before/after', async () => {
    const gm = await createEmployee({ role: 'gm' });
    const create = await post('/api/admin/promos', { code: 'PA7TEST', kind: 'fixed', value: 10000 }, gm.accessToken);
    const promo = (await create.json()) as { id: string };
    await patch(`/api/admin/promos/${promo.id}`, { value: 20000 }, gm.accessToken);

    const { rows } = await pool.query<{ action: string; before: unknown; after: unknown }>(
      `SELECT action, before, after FROM audit_events WHERE target_id = $1 ORDER BY created_at`,
      [promo.id],
    );
    expect(rows.map((r) => r.action)).toEqual(['promo.create', 'promo.update']);
    expect(rows[1]!.before).not.toBeNull();
    expect(rows[1]!.after).not.toBeNull();
  });

  it('PA-8: redemptions view distinguishes held, consumed and released counts', async () => {
    const gm = await createEmployee({ role: 'gm' });
    const room = await createRoomType({ basePricePaise: 500000, baseAllotment: 10, physicalStock: 10 });
    const promo = await createPromo({ code: 'PA8TEST', kind: 'fixed', value: 10000, maxUses: 10 });
    await confirmedBookingWithPromo(room.id, 'PA8TEST'); // consumed

    const response = await get(`/api/admin/promos/${promo.id}/redemptions`, gm.accessToken);
    expect(response.status).toBe(200);
    const body = (await response.json()) as { counts: { held: number; consumed: number; released: number } };
    expect(body.counts.consumed).toBe(1);
    expect(body.counts.held).toBe(0);
    expect(body.counts.released).toBe(0);
  });
});
