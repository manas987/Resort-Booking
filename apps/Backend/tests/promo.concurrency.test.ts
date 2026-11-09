/**
 * PR-1, PR-2, PR-4..PR-8 (Docs/tests-phase1.md, 1F/1G). PR-3 (an expired HOLD releases promo
 * capacity) needs `expireBookingHold`, which does not exist before 1H — re-add there.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'bun:test';
import type { AddressInfo } from 'node:net';
import { createApp } from '../src/app.ts';
import { pool } from '../src/db.ts';
import { requireTestDatabase, resetDatabase } from './helpers/db.ts';
import { createRoomType, futureDate, publishResortInfo, createGuest, createPromo } from './helpers/factories.ts';

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

async function quoteWithPromo(roomTypeId: string, checkIn: string, checkOut: string, promoCode: string): Promise<string> {
  const response = await post('/api/user/quotes', {
    checkIn,
    checkOut,
    rooms: [{ roomTypeId, adults: 1, children: 0 }],
    promoCode,
  });
  const body = (await response.json()) as { quoteId: string };
  return body.quoteId;
}

async function hold(quoteId: string, accessToken: string, idempotencyKey?: string): Promise<Response> {
  return post(
    '/api/user/bookings',
    { quoteId, guestName: 'Promo Guest', guestEmail: `g-${crypto.randomUUID()}@example.com`, guestPhone: '9000000000' },
    accessToken,
    idempotencyKey ?? crypto.randomUUID(),
  );
}

describe('promo.concurrency — 1F, 1G', () => {
  it('PR-1: max_uses=1, two concurrent holds — exactly one consumes it, the other gets promo_exhausted', async () => {
    const room = await createRoomType({ baseAllotment: 10, physicalStock: 10 });
    const checkIn = futureDate(10);
    const checkOut = futureDate(11);
    await createPromo({ code: 'ONEUSE', kind: 'fixed', value: 10000, maxUses: 1 });
    const guestA = await createGuest();
    const guestB = await createGuest();
    const quoteA = await quoteWithPromo(room.id, checkIn, checkOut, 'ONEUSE');
    const quoteB = await quoteWithPromo(room.id, checkIn, checkOut, 'ONEUSE');

    const results = await Promise.allSettled([hold(quoteA, guestA.accessToken), hold(quoteB, guestB.accessToken)]);
    const statuses = await Promise.all(results.map((r) => (r.status === 'fulfilled' ? r.value.status : 0)));
    expect(statuses.filter((s) => s === 201)).toHaveLength(1);
    expect(statuses.filter((s) => s === 409)).toHaveLength(1);

    const { rows } = await pool.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM promo_redemptions WHERE state <> 'released'`,
    );
    expect(rows[0]!.n).toBe(1);
  });

  it('PR-2: max_uses=3, 10 concurrent holds — exactly 3 redemptions', async () => {
    const room = await createRoomType({ baseAllotment: 20, physicalStock: 20 });
    const checkIn = futureDate(10);
    const checkOut = futureDate(11);
    await createPromo({ code: 'THREEUSE', kind: 'fixed', value: 10000, maxUses: 3 });
    const guests = await Promise.all(Array.from({ length: 10 }, () => createGuest()));
    const quotes = await Promise.all(guests.map(() => quoteWithPromo(room.id, checkIn, checkOut, 'THREEUSE')));

    const results = await Promise.allSettled(guests.map((g, i) => hold(quotes[i]!, g.accessToken)));
    const statuses = await Promise.all(results.map((r) => (r.status === 'fulfilled' ? r.value.status : 0)));
    expect(statuses.filter((s) => s === 201)).toHaveLength(3);

    const { rows } = await pool.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM promo_redemptions WHERE state <> 'released'`,
    );
    expect(rows[0]!.n).toBe(3);
  });

  it('PR-4: a quote request cannot carry two promo codes — one string field, not an array (INV-32)', async () => {
    // Enforced by construction: createQuoteSchema's `promoCode` is a single optional string.
    // There is no request shape in which a second code could even be sent.
    const room = await createRoomType();
    const response = await post('/api/user/quotes', {
      checkIn: futureDate(10),
      checkOut: futureDate(11),
      rooms: [{ roomTypeId: room.id, adults: 1, children: 0 }],
      promoCode: ['CODE1', 'CODE2'],
    });
    expect(response.status).toBe(400); // rejected as a type error, not accepted as stacking
  });

  it('PR-5: a code expired yesterday is rejected even for a stay next month (booking-time rule)', async () => {
    await createPromo({ code: 'YESTERDAY', kind: 'fixed', value: 10000, startsAt: futureDate(-30), endsAt: futureDate(-1) });
    const response = await post('/api/user/promos/validate', { code: 'YESTERDAY' });
    const body = (await response.json()) as { valid: boolean };
    expect(body.valid).toBe(false);
  });

  it('PR-6: a code valid now is accepted even if the stay is after its own expiry (booking-time, not stay-time)', async () => {
    await createPromo({ code: 'VALIDNOW', kind: 'fixed', value: 10000, startsAt: futureDate(-1), endsAt: futureDate(5) });
    const response = await post('/api/user/promos/validate', { code: 'VALIDNOW' });
    const body = (await response.json()) as { valid: boolean };
    expect(body.valid).toBe(true);
    // The quote itself can price a stay well after the promo's own end date.
    const room = await createRoomType();
    const quoteResponse = await post('/api/user/quotes', {
      checkIn: futureDate(60),
      checkOut: futureDate(61),
      rooms: [{ roomTypeId: room.id, adults: 1, children: 0 }],
      promoCode: 'VALIDNOW',
    });
    expect(quoteResponse.status).toBe(201);
  });

  it('PR-7: an inactive code is rejected', async () => {
    await createPromo({ code: 'INACTIVE', kind: 'fixed', value: 10000, isActive: false });
    const response = await post('/api/user/promos/validate', { code: 'INACTIVE' });
    const body = (await response.json()) as { valid: boolean };
    expect(body.valid).toBe(false);
  });

  it('PR-8: the same booking request replayed with one idempotency key produces one redemption, not two', async () => {
    const room = await createRoomType({ baseAllotment: 10, physicalStock: 10 });
    await createPromo({ code: 'REPLAY', kind: 'fixed', value: 10000 });
    const guest = await createGuest();
    const quoteId = await quoteWithPromo(room.id, futureDate(10), futureDate(11), 'REPLAY');
    const key = crypto.randomUUID();

    // Same body both times — a replay is only a replay when the request is identical.
    const body = { quoteId, guestName: 'Replay Guest', guestEmail: 'replay@example.com', guestPhone: '9000000000' };
    const first = await post('/api/user/bookings', body, guest.accessToken, key);
    const firstBody = await first.clone().json();
    const second = await post('/api/user/bookings', body, guest.accessToken, key);
    expect(first.status).toBe(201);
    // Replayed with the ORIGINAL response_code (201) and body — not a fresh 2xx, not re-run
    // through the controller a second time (INV-30, same decision table as ID-1).
    expect(second.status).toBe(201);
    expect(await second.json()).toEqual(firstBody);

    const { rows } = await pool.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM promo_redemptions WHERE state <> 'released'`,
    );
    expect(rows[0]!.n).toBe(1);
  });
});
