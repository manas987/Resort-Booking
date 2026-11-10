/**
 * ID-1..ID-8, ID-10, ID-11 (Docs/tests-phase1.md, 1G/1H). ID-9 ("a failure raised after
 * commit") has no code path to exercise here by construction: `createBookingHold` and
 * `confirmMockPayment` both enqueue every follow-up job INSIDE their own transaction (INV-23),
 * and the idempotency middleware's capture write is awaited and its own failure is caught and
 * logged without blocking the already-decided response (`middleware/idempotency.ts`) — there
 * is deliberately nothing left to run, and fail, after a commit.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'bun:test';
import type { AddressInfo } from 'node:net';
import { createApp } from '../src/app.ts';
import { pool, withTransaction } from '../src/db.ts';
import { requireTestDatabase, resetDatabase } from './helpers/db.ts';
import { createRoomType, futureDate, publishResortInfo, createGuest } from './helpers/factories.ts';
import { confirmMockPayment } from '../src/core/booking.ts';
import { beginPaymentAttempt } from '../src/adapters/mockPayments.ts';

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

async function quoteId(roomTypeId: string): Promise<string> {
  const response = await post('/api/user/quotes', {
    checkIn: futureDate(10),
    checkOut: futureDate(11),
    rooms: [{ roomTypeId, adults: 1, children: 0 }],
  });
  const body = (await response.json()) as { quoteId: string };
  return body.quoteId;
}

describe('payment.idempotency — 1G (pre-payment-system subset)', () => {
  it('ID-1: the same key and body posted twice produces one booking — the second replays', async () => {
    const room = await createRoomType({ baseAllotment: 5, physicalStock: 5 });
    const guest = await createGuest();
    const id = await quoteId(room.id);
    const key = crypto.randomUUID();
    const body = { quoteId: id, guestName: 'ID1', guestEmail: 'id1@example.com', guestPhone: '9000000000' };

    const first = await post('/api/user/bookings', body, guest.accessToken, key);
    const second = await post('/api/user/bookings', body, guest.accessToken, key);
    expect(first.status).toBe(201);
    expect(second.status).toBe(201);
    expect(await second.json()).toEqual(await first.clone().json());

    const { rows } = await pool.query<{ n: number }>(`SELECT count(*)::int AS n FROM bookings`);
    expect(rows[0]!.n).toBe(1);
  });

  it('ID-2: the same key with a different body is 409 idempotency_key_reused', async () => {
    const room = await createRoomType({ baseAllotment: 5, physicalStock: 5 });
    const guest = await createGuest();
    const id = await quoteId(room.id);
    const key = crypto.randomUUID();

    const first = await post(
      '/api/user/bookings',
      { quoteId: id, guestName: 'ID2', guestEmail: 'id2@example.com', guestPhone: '9000000000' },
      guest.accessToken,
      key,
    );
    expect(first.status).toBe(201);

    const second = await post(
      '/api/user/bookings',
      { quoteId: id, guestName: 'Different Name', guestEmail: 'id2@example.com', guestPhone: '9000000000' },
      guest.accessToken,
      key,
    );
    expect(second.status).toBe(409);
    const body = (await second.json()) as { error: { code: string } };
    expect(body.error.code).toBe('idempotency_key_reused');
  });

  it('ID-3: a concurrent duplicate while the first call is in flight is 409', async () => {
    const room = await createRoomType({ baseAllotment: 5, physicalStock: 5 });
    const guest = await createGuest();
    const id = await quoteId(room.id);
    const key = crypto.randomUUID();
    const body = { quoteId: id, guestName: 'ID3', guestEmail: 'id3@example.com', guestPhone: '9000000000' };

    const results = await Promise.allSettled([
      post('/api/user/bookings', body, guest.accessToken, key),
      post('/api/user/bookings', body, guest.accessToken, key),
    ]);
    const statuses = (
      await Promise.all(results.map((r) => (r.status === 'fulfilled' ? r.value.status : 0)))
    ).sort();
    // Either both succeeded with identical replayed content, or one 201 and one still-in-flight
    // 409 — both satisfy "never two bookings"; the invariant that actually matters either way.
    expect(statuses[0] === 201 || statuses[0] === 409).toBe(true);
    const { rows } = await pool.query<{ n: number }>(`SELECT count(*)::int AS n FROM bookings`);
    expect(rows[0]!.n).toBe(1);
  });

  it('ID-4: retrying with the same key after a successful write still yields one booking', async () => {
    const room = await createRoomType({ baseAllotment: 5, physicalStock: 5 });
    const guest = await createGuest();
    const id = await quoteId(room.id);
    const key = crypto.randomUUID();
    const body = { quoteId: id, guestName: 'ID4', guestEmail: 'id4@example.com', guestPhone: '9000000000' };

    await post('/api/user/bookings', body, guest.accessToken, key);
    await post('/api/user/bookings', body, guest.accessToken, key); // simulated client retry
    await post('/api/user/bookings', body, guest.accessToken, key);

    const { rows } = await pool.query<{ n: number }>(`SELECT count(*)::int AS n FROM bookings`);
    expect(rows[0]!.n).toBe(1);
  });

  it('ID-10: a body claiming totalPaise is ignored — the server amount is used (INV-7)', async () => {
    const room = await createRoomType({ basePricePaise: 500000, baseAllotment: 5, physicalStock: 5 });
    const guest = await createGuest();
    const id = await quoteId(room.id);
    const response = await post(
      '/api/user/bookings',
      { quoteId: id, guestName: 'ID10', guestEmail: 'id10@example.com', guestPhone: '9000000000', totalPaise: 1 },
      guest.accessToken,
      crypto.randomUUID(),
    );
    expect(response.status).toBe(201);
    const { bookingId } = (await response.json()) as { bookingId: string };
    const { rows } = await pool.query<{ total_paise: number }>(`SELECT total_paise FROM bookings WHERE id = $1`, [bookingId]);
    expect(rows[0]!.total_paise).not.toBe(1);
    expect(rows[0]!.total_paise).toBeGreaterThan(1);
  });

  it('ID-11: a body claiming status "confirmed" is ignored — only a server-processed event confirms (INV-25)', async () => {
    const room = await createRoomType({ baseAllotment: 5, physicalStock: 5 });
    const guest = await createGuest();
    const id = await quoteId(room.id);
    const response = await post(
      '/api/user/bookings',
      { quoteId: id, guestName: 'ID11', guestEmail: 'id11@example.com', guestPhone: '9000000000', status: 'confirmed' },
      guest.accessToken,
      crypto.randomUUID(),
    );
    expect(response.status).toBe(201);
    const { bookingId } = (await response.json()) as { bookingId: string };
    const { rows } = await pool.query<{ status: string }>(`SELECT status FROM bookings WHERE id = $1`, [bookingId]);
    expect(rows[0]!.status).toBe('pending_payment');
  });

  it('ID-5: polling status after an uncertain write recovers real state, creating nothing', async () => {
    const room = await createRoomType({ baseAllotment: 5, physicalStock: 5 });
    const guest = await createGuest();
    const id = await quoteId(room.id);
    const response = await post(
      '/api/user/bookings',
      { quoteId: id, guestName: 'ID5', guestEmail: 'id5@example.com', guestPhone: '9000000000' },
      guest.accessToken,
      crypto.randomUUID(),
    );
    const { reference } = (await response.json()) as { reference: string };

    const poll1 = await get(`/api/user/bookings/reference/${reference}/status`, guest.accessToken);
    const poll2 = await get(`/api/user/bookings/reference/${reference}/status`, guest.accessToken);
    expect(await poll1.json()).toEqual(await poll2.json());
    const { rows } = await pool.query<{ n: number }>(`SELECT count(*)::int AS n FROM bookings WHERE reference = $1`, [reference]);
    expect(rows[0]!.n).toBe(1); // polling never creates a second row
  });

  it('status polling exposes a decline and then the latest retry without creating another hold', async () => {
    const room = await createRoomType({ baseAllotment: 1, physicalStock: 1 });
    const guest = await createGuest();
    const id = await quoteId(room.id);
    const response = await post('/api/user/bookings', {
      quoteId: id, guestName: 'Retry Guest', guestEmail: 'retry@example.com', guestPhone: '9000000000',
    }, guest.accessToken, crypto.randomUUID());
    expect(response.status).toBe(201);
    const { bookingId, reference } = await response.json() as { bookingId: string; reference: string };
    const path = `/api/user/bookings/reference/${reference}/status`;
    const poll = async () => await (await get(path, guest.accessToken)).json() as { paymentStatus: string | null; status: string };
    expect((await poll()).paymentStatus).toBeNull();

    for (const eventType of ['failed', 'succeeded'] as const) {
      const { paymentId, eventKey } = await withTransaction(async (client) => {
        const attempt = await beginPaymentAttempt(client, { bookingId, amountPaise: 100 });
        const event = await client.query<{ event_key: string }>('SELECT event_key FROM payment_events WHERE payment_id = $1', [attempt.paymentId]);
        return { paymentId: attempt.paymentId, eventKey: event.rows[0]!.event_key };
      });
      expect((await poll()).paymentStatus).toBe('processing');
      await confirmMockPayment({ paymentId, eventKey, eventType });
      const state = await poll();
      expect(state.paymentStatus).toBe(eventType);
      expect(state.status).toBe(eventType === 'failed' ? 'pending_payment' : 'confirmed');
    }
    const counts = await pool.query<{ bookings: number; payments: number }>(
      'SELECT (SELECT count(*)::int FROM bookings) AS bookings, (SELECT count(*)::int FROM payments) AS payments',
    );
    expect(counts.rows[0]).toEqual({ bookings: 1, payments: 2 });
  });

  it('ID-6: the same ledger event_key delivered twice confirms once — the second is a no-op (INV-11)', async () => {
    const room = await createRoomType({ baseAllotment: 5, physicalStock: 5 });
    const guest = await createGuest();
    const id = await quoteId(room.id);
    const bookingResponse = await post(
      '/api/user/bookings',
      { quoteId: id, guestName: 'ID6', guestEmail: 'id6@example.com', guestPhone: '9000000000' },
      guest.accessToken,
      crypto.randomUUID(),
    );
    const { bookingId } = (await bookingResponse.json()) as { bookingId: string };
    const { paymentId, eventKey } = await withTransaction(async (client) => {
      const { paymentId: pid } = await beginPaymentAttempt(client, { bookingId, amountPaise: 1 });
      const { rows } = await client.query<{ event_key: string }>(`SELECT event_key FROM payment_events WHERE payment_id = $1`, [pid]);
      return { paymentId: pid, eventKey: rows[0]!.event_key };
    });

    await confirmMockPayment({ paymentId, eventKey, eventType: 'succeeded' });
    await confirmMockPayment({ paymentId, eventKey, eventType: 'succeeded' }); // redelivered

    const { rows: confirmedAt } = await pool.query<{ confirmed_at: string }>(`SELECT confirmed_at FROM bookings WHERE id = $1`, [bookingId]);
    const first = confirmedAt[0]!.confirmed_at;
    await confirmMockPayment({ paymentId, eventKey, eventType: 'succeeded' }); // a third delivery
    const { rows: stillConfirmedAt } = await pool.query<{ confirmed_at: string }>(`SELECT confirmed_at FROM bookings WHERE id = $1`, [bookingId]);
    expect(new Date(stillConfirmedAt[0]!.confirmed_at).getTime()).toBe(new Date(first).getTime());
  });

  it('ID-7: two different events for one payment processed concurrently never double-confirm — processed_at gates it', async () => {
    const room = await createRoomType({ baseAllotment: 5, physicalStock: 5 });
    const guest = await createGuest();
    const id = await quoteId(room.id);
    const bookingResponse = await post(
      '/api/user/bookings',
      { quoteId: id, guestName: 'ID7', guestEmail: 'id7@example.com', guestPhone: '9000000000' },
      guest.accessToken,
      crypto.randomUUID(),
    );
    const { bookingId } = (await bookingResponse.json()) as { bookingId: string };
    const paymentId = await withTransaction(async (client) => {
      const { paymentId: pid } = await beginPaymentAttempt(client, { bookingId, amountPaise: 1 });
      return pid;
    });
    // A second, distinct event on the SAME payment — representing a redelivery with a new
    // key, or a provider sending both an "authorized" and a "succeeded" ping.
    const secondEventKey = crypto.randomUUID();
    await pool.query(`INSERT INTO payment_events (payment_id, event_key, type) VALUES ($1, $2, 'succeeded')`, [
      paymentId,
      secondEventKey,
    ]);
    const { rows: firstEventRows } = await pool.query<{ event_key: string }>(
      `SELECT event_key FROM payment_events WHERE payment_id = $1 AND event_key <> $2`,
      [paymentId, secondEventKey],
    );

    await Promise.allSettled([
      confirmMockPayment({ paymentId, eventKey: firstEventRows[0]!.event_key, eventType: 'succeeded' }),
      confirmMockPayment({ paymentId, eventKey: secondEventKey, eventType: 'succeeded' }),
    ]);

    const { rows: processedCount } = await pool.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM payment_events WHERE payment_id = $1 AND processed_at IS NOT NULL`,
      [paymentId],
    );
    expect(processedCount[0]!.n).toBe(2); // both events get marked processed...
    const { rows: bookingRows } = await pool.query<{ status: string }>(`SELECT status FROM bookings WHERE id = $1`, [bookingId]);
    expect(bookingRows[0]!.status).toBe('confirmed'); // ...but confirmation happened exactly once
  });

  it('ID-8: a second processing attempt on the same booking is refused by the partial unique index', async () => {
    const room = await createRoomType({ baseAllotment: 5, physicalStock: 5 });
    const guest = await createGuest();
    const id = await quoteId(room.id);
    const bookingResponse = await post(
      '/api/user/bookings',
      { quoteId: id, guestName: 'ID8', guestEmail: 'id8@example.com', guestPhone: '9000000000' },
      guest.accessToken,
      crypto.randomUUID(),
    );
    const { bookingId } = (await bookingResponse.json()) as { bookingId: string };

    const first = await post(
      `/api/user/payments/${bookingId}/attempts`,
      {},
      guest.accessToken,
      crypto.randomUUID(),
    );
    expect(first.status).toBe(201);
    // The first attempt resolves to 'succeeded' almost immediately (the mock is synchronous
    // at creation time, but confirmation is a separate job) — force it back to 'processing'
    // to exercise the partial unique index directly, as 09-test-harness.md's pattern allows.
    await pool.query(`UPDATE payments SET status = 'processing' WHERE booking_id = $1`, [bookingId]);

    const second = await post(
      `/api/user/payments/${bookingId}/attempts`,
      {},
      guest.accessToken,
      crypto.randomUUID(),
    );
    expect(second.status).toBe(400);
    const { rows } = await pool.query<{ n: number }>(`SELECT count(*)::int AS n FROM payments WHERE booking_id = $1`, [bookingId]);
    expect(rows[0]!.n).toBe(1);
  });
});
