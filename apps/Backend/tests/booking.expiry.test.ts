/**
 * EX-1..EX-7 (Docs/tests-phase1.md, 1G/1H).
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'bun:test';
import type { AddressInfo } from 'node:net';
import { createApp } from '../src/app.ts';
import { pool } from '../src/db.ts';
import { requireTestDatabase, resetDatabase } from './helpers/db.ts';
import { createRoomType, futureDate, publishResortInfo, createGuest, createPromo } from './helpers/factories.ts';
import { expireBookingHold, confirmMockPayment } from '../src/core/booking.ts';
import { beginPaymentAttempt } from '../src/adapters/mockPayments.ts';
import { withTransaction } from '../src/db.ts';
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
async function get(path: string, accessToken: string): Promise<Response> {
  return fetch(`${baseUrl}${path}`, { headers: { authorization: `Bearer ${accessToken}` } });
}

async function createHold(
  roomTypeId: string,
  guestAccessToken: string,
  promoCode?: string,
): Promise<{ bookingId: string }> {
  const quoteResponse = await post('/api/user/quotes', {
    checkIn: futureDate(10),
    checkOut: futureDate(11),
    rooms: [{ roomTypeId, adults: 1, children: 0 }],
    promoCode,
  });
  const { quoteId } = (await quoteResponse.json()) as { quoteId: string };
  const bookingResponse = await post(
    '/api/user/bookings',
    { quoteId, guestName: 'Expiry Guest', guestEmail: `g-${crypto.randomUUID()}@example.com`, guestPhone: '9000000000' },
    guestAccessToken,
    crypto.randomUUID(),
  );
  return (await bookingResponse.json()) as { bookingId: string };
}

describe('booking.expiry — 1G, 1H', () => {
  it('EX-1: hold_expires_at is server-stamped at roughly now + 10 minutes', async () => {
    const room = await createRoomType();
    const guest = await createGuest();
    const before = Date.now();
    const { bookingId } = await createHold(room.id, guest.accessToken);
    const { rows } = await pool.query<{ hold_expires_at: string }>(
      `SELECT hold_expires_at FROM bookings WHERE id = $1`,
      [bookingId],
    );
    const deltaMinutes = (new Date(rows[0]!.hold_expires_at).getTime() - before) / 60_000;
    expect(deltaMinutes).toBeGreaterThan(9.5);
    expect(deltaMinutes).toBeLessThan(10.5);
  });

  it('EX-2: repeated reads never move hold_expires_at — a refresh does not restart the countdown', async () => {
    const room = await createRoomType();
    const guest = await createGuest();
    const { bookingId } = await createHold(room.id, guest.accessToken);

    const first = await get(`/api/user/bookings/${bookingId}`, guest.accessToken);
    const firstBody = (await first.json()) as { holdExpiresAt: string };
    await new Promise((resolve) => setTimeout(resolve, 20));
    const second = await get(`/api/user/bookings/${bookingId}`, guest.accessToken);
    const secondBody = (await second.json()) as { holdExpiresAt: string };
    expect(secondBody.holdExpiresAt).toBe(firstBody.holdExpiresAt);
  });

  it('EX-3: the worker expires a lapsed hold and releases promo capacity', async () => {
    const room = await createRoomType();
    await createPromo({ code: 'EX3', kind: 'fixed', value: 10000 });
    const guest = await createGuest();
    const { bookingId } = await createHold(room.id, guest.accessToken, 'EX3');
    await pool.query(
      `UPDATE bookings SET hold_expires_at = now() - interval '1 second' WHERE id = $1`,
      [bookingId],
    );
    await pool.query(`UPDATE jobs SET run_after = now() - interval '1 second' WHERE type = 'expire_holds'`);

    const processed = await processBatch('test-worker-ex3');
    expect(processed).toBeGreaterThan(0);

    const { rows: bookingRows } = await pool.query<{ status: string }>(`SELECT status FROM bookings WHERE id = $1`, [bookingId]);
    expect(bookingRows[0]!.status).toBe('expired');
    const { rows: redemptionRows } = await pool.query<{ state: string }>(
      `SELECT state FROM promo_redemptions WHERE booking_id = $1`,
      [bookingId],
    );
    expect(redemptionRows[0]!.state).toBe('released');
  });

  it('EX-4: running the worker twice on an already-expired hold is idempotent — one transition, one release', async () => {
    const room = await createRoomType();
    const guest = await createGuest();
    const { bookingId } = await createHold(room.id, guest.accessToken);
    await pool.query(`UPDATE bookings SET hold_expires_at = now() - interval '1 second' WHERE id = $1`, [bookingId]);

    await expireBookingHold(bookingId);
    const { rows: afterFirst } = await pool.query<{ expired_at: string }>(`SELECT expired_at FROM bookings WHERE id = $1`, [bookingId]);
    await expireBookingHold(bookingId); // second run — must not re-stamp expired_at or throw
    const { rows: afterSecond } = await pool.query<{ expired_at: string; status: string }>(
      `SELECT expired_at, status FROM bookings WHERE id = $1`,
      [bookingId],
    );
    expect(afterSecond[0]!.status).toBe('expired');
    expect(new Date(afterSecond[0]!.expired_at).getTime()).toBe(new Date(afterFirst[0]!.expired_at).getTime());
  });

  it('EX-5: payment success and expiry racing concurrently never produce both or neither outcome', async () => {
    const room = await createRoomType();
    const guest = await createGuest();
    const { bookingId } = await createHold(room.id, guest.accessToken);
    await pool.query(`UPDATE bookings SET hold_expires_at = now() - interval '1 second' WHERE id = $1`, [bookingId]);

    const { paymentId, eventKey } = await withTransaction(async (client) => {
      const { paymentId: pid } = await beginPaymentAttempt(client, { bookingId, amountPaise: 1 });
      const { rows } = await client.query<{ event_key: string }>(
        `SELECT event_key FROM payment_events WHERE payment_id = $1`,
        [pid],
      );
      return { paymentId: pid, eventKey: rows[0]!.event_key };
    });

    await Promise.allSettled([
      expireBookingHold(bookingId),
      confirmMockPayment({ paymentId, eventKey, eventType: 'succeeded' }),
    ]);
    await processBatch('test-worker-ex5'); // runs the refund_late_payment job confirmMockPayment enqueued

    const { rows: bookingRows } = await pool.query<{ status: string }>(`SELECT status FROM bookings WHERE id = $1`, [bookingId]);
    const { rows: refundRows } = await pool.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM refunds WHERE payment_id = $1`,
      [paymentId],
    );
    // The hold already lapsed (hold_expires_at is in the past) before either writer started,
    // and both lock the same bookings row FOR UPDATE, so Postgres serialises them regardless
    // of which call's promise settles "first" in JS. `confirmMockPayment` checks the hold's
    // CURRENT liveness (status AND hold_expires_at), not a value cached before the race — so
    // whichever one commits first, the other reads the truth and takes the released-booking
    // branch too. Exactly one outcome persists: expired, with one refund. Never confirmed.
    expect(bookingRows[0]!.status).toBe('expired');
    expect(refundRows[0]!.n).toBe(1);
  });

  it('EX-6: payment succeeds after expiry — booking stays expired, exactly one refund, no revival (INV-12)', async () => {
    const room = await createRoomType();
    const guest = await createGuest();
    const { bookingId } = await createHold(room.id, guest.accessToken);

    const { paymentId, eventKey } = await withTransaction(async (client) => {
      const { paymentId: pid } = await beginPaymentAttempt(client, { bookingId, amountPaise: 1 });
      const { rows } = await client.query<{ event_key: string }>(
        `SELECT event_key FROM payment_events WHERE payment_id = $1`,
        [pid],
      );
      return { paymentId: pid, eventKey: rows[0]!.event_key };
    });

    await expireBookingHold(bookingId); // expiry happens first, cleanly
    await confirmMockPayment({ paymentId, eventKey, eventType: 'succeeded' }); // then the late success
    await processBatch('test-worker-ex6'); // runs the enqueued refund_late_payment job

    const { rows: bookingRows } = await pool.query<{ status: string }>(`SELECT status FROM bookings WHERE id = $1`, [bookingId]);
    expect(bookingRows[0]!.status).toBe('expired');
    const { rows: refundRows } = await pool.query<{ n: number }>(`SELECT count(*)::int AS n FROM refunds WHERE payment_id = $1`, [paymentId]);
    expect(refundRows[0]!.n).toBe(1);
  });

  it('EX-7: booking status and payment status are separate columns (INV-31)', async () => {
    const room = await createRoomType();
    const guest = await createGuest();
    const { bookingId } = await createHold(room.id, guest.accessToken);
    const { paymentId, eventKey } = await withTransaction(async (client) => {
      const { paymentId: pid } = await beginPaymentAttempt(client, { bookingId, amountPaise: 1 });
      const { rows } = await client.query<{ event_key: string }>(
        `SELECT event_key FROM payment_events WHERE payment_id = $1`,
        [pid],
      );
      return { paymentId: pid, eventKey: rows[0]!.event_key };
    });
    await confirmMockPayment({ paymentId, eventKey, eventType: 'succeeded' });

    const { rows: bookingRows } = await pool.query<{ status: string }>(`SELECT status FROM bookings WHERE id = $1`, [bookingId]);
    const { rows: paymentRows } = await pool.query<{ status: string }>(`SELECT status FROM payments WHERE id = $1`, [paymentId]);
    expect(bookingRows[0]!.status).toBe('confirmed');
    expect(paymentRows[0]!.status).toBe('succeeded');
  });
});
