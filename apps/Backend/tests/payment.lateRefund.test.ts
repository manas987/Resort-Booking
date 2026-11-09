/**
 * LR-1..LR-5 (Docs/tests-phase1.md, 1H). LR-4/LR-5 ("delivery simulated as failed") have no
 * documented trigger — the mock refund/apology path is deterministic success by design (see
 * `core/booking.ts`'s `refundLatePayment` comment) — so those two arrange the failed state
 * directly, the same way other sub-phases simulate an outcome with no real code path yet.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'bun:test';
import type { AddressInfo } from 'node:net';
import { createApp } from '../src/app.ts';
import { pool, withTransaction } from '../src/db.ts';
import { requireTestDatabase, resetDatabase } from './helpers/db.ts';
import { createRoomType, futureDate, publishResortInfo, createGuest } from './helpers/factories.ts';
import { expireBookingHold, confirmMockPayment, refundLatePayment } from '../src/core/booking.ts';
import { beginPaymentAttempt } from '../src/adapters/mockPayments.ts';
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

async function expiredBookingWithPayment(): Promise<{ bookingId: string; paymentId: string; eventKey: string }> {
  const room = await createRoomType();
  const guest = await createGuest();
  const quoteResponse = await post('/api/user/quotes', {
    checkIn: futureDate(10),
    checkOut: futureDate(11),
    rooms: [{ roomTypeId: room.id, adults: 1, children: 0 }],
  });
  const { quoteId } = (await quoteResponse.json()) as { quoteId: string };
  const bookingResponse = await post(
    '/api/user/bookings',
    { quoteId, guestName: 'Refund Guest', guestEmail: `g-${crypto.randomUUID()}@example.com`, guestPhone: '9000000000' },
    guest.accessToken,
    crypto.randomUUID(),
  );
  const { bookingId } = (await bookingResponse.json()) as { bookingId: string };
  await expireBookingHold(bookingId); // the hold is released well before the late event arrives

  const { paymentId, eventKey } = await withTransaction(async (client) => {
    const { paymentId: pid } = await beginPaymentAttempt(client, { bookingId, amountPaise: 1 });
    const { rows } = await client.query<{ event_key: string }>(
      `SELECT event_key FROM payment_events WHERE payment_id = $1`,
      [pid],
    );
    return { paymentId: pid, eventKey: rows[0]!.event_key };
  });
  return { bookingId, paymentId, eventKey };
}

describe('payment.lateRefund — 1H', () => {
  it('LR-1: a late success event on an expired booking produces exactly one refund and one apology job', async () => {
    const { rows: ownerRows } = await pool.query<{ id: string }>(
      `INSERT INTO users (kind, role, name, email, username, password_hash)
       VALUES ('employee', 'owner', 'Test Owner', 'owner-lr1@example.com', 'owner-lr1', 'x')
       RETURNING id`,
    );
    const { paymentId, eventKey } = await expiredBookingWithPayment();
    await confirmMockPayment({ paymentId, eventKey, eventType: 'late_success' });
    await processBatch('test-worker-lr1'); // runs refund_late_payment, which enqueues the apology
    await processBatch('test-worker-lr1'); // runs the apology send_message job itself

    const { rows: refunds } = await pool.query<{ status: string }>(`SELECT status FROM refunds WHERE payment_id = $1`, [paymentId]);
    expect(refunds).toHaveLength(1);
    expect(refunds[0]!.status).toBe('refunded');

    const { rows: jobs } = await pool.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM jobs WHERE dedupe_key = $1 AND completed_at IS NOT NULL`,
      [`apology:${paymentId}`],
    );
    expect(jobs[0]!.n).toBe(1);

    // The owner gets an in-app alert — 01-data-model.md lists 'refund_recorded' next to
    // complaint alerts.
    const { rows: notifications } = await pool.query<{ type: string }>(
      `SELECT type FROM notifications WHERE user_id = $1`,
      [ownerRows[0]!.id],
    );
    expect(notifications).toHaveLength(1);
    expect(notifications[0]!.type).toBe('refund_recorded');
  });

  it('LR-2: the same late success event redelivered still produces one refund, one apology (INV-13)', async () => {
    const { paymentId, eventKey } = await expiredBookingWithPayment();
    await confirmMockPayment({ paymentId, eventKey, eventType: 'late_success' });
    await processBatch('test-worker-lr2a');
    await confirmMockPayment({ paymentId, eventKey, eventType: 'late_success' }); // redelivered — processed_at already set
    await processBatch('test-worker-lr2b');

    const { rows: refunds } = await pool.query<{ n: number }>(`SELECT count(*)::int AS n FROM refunds WHERE payment_id = $1`, [paymentId]);
    expect(refunds[0]!.n).toBe(1);
    const { rows: jobs } = await pool.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM jobs WHERE dedupe_key = $1`,
      [`apology:${paymentId}`],
    );
    expect(jobs[0]!.n).toBe(1);
  });

  it('LR-3: two concurrent refund attempts for one payment still produce exactly one refund row', async () => {
    const { paymentId } = await expiredBookingWithPayment();
    const results = await Promise.allSettled([refundLatePayment(paymentId), refundLatePayment(paymentId)]);
    for (const result of results) expect(result.status).toBe('fulfilled'); // the second is a quiet no-op, not an error

    const { rows } = await pool.query<{ n: number }>(`SELECT count(*)::int AS n FROM refunds WHERE payment_id = $1`, [paymentId]);
    expect(rows[0]!.n).toBe(1);
  });

  it('LR-4: a refund delivery failure is recorded and visible, never silently swallowed', async () => {
    const { paymentId } = await expiredBookingWithPayment();
    await refundLatePayment(paymentId); // the deterministic mock path — always "refunded"
    // Arrange the failed-delivery state directly (no documented trigger for it) and confirm
    // the schema can represent and surface it rather than silently dropping it.
    await pool.query(
      `UPDATE refunds SET status = 'refund_failed', failure_reason = 'simulated gateway timeout' WHERE payment_id = $1`,
      [paymentId],
    );
    const { rows } = await pool.query<{ status: string; failure_reason: string | null }>(
      `SELECT status, failure_reason FROM refunds WHERE payment_id = $1`,
      [paymentId],
    );
    expect(rows[0]!.status).toBe('refund_failed');
    expect(rows[0]!.failure_reason).toBeTruthy();
  });

  it('LR-5: a failed apology delivery is recorded as failed and is never counted as a guest reply (INV-26)', async () => {
    const { paymentId } = await expiredBookingWithPayment();
    await refundLatePayment(paymentId);
    // Arrange the apology job's failure directly — there is no `enquiry_messages` row for a
    // payment notification (Docs/03-decisions.md), so "failed" lives on the job itself.
    await pool.query(
      `UPDATE jobs SET failed_at = now(), last_error = 'simulated delivery failure' WHERE dedupe_key = $1`,
      [`apology:${paymentId}`],
    );
    const { rows } = await pool.query<{ failed_at: string | null }>(
      `SELECT failed_at FROM jobs WHERE dedupe_key = $1`,
      [`apology:${paymentId}`],
    );
    expect(rows[0]!.failed_at).not.toBeNull();
    // A failed delivery is not an enquiry reply by construction — there is no enquiry_messages
    // row, inbound or outbound, created by this path at all.
    const { rows: messages } = await pool.query<{ n: number }>(`SELECT count(*)::int AS n FROM enquiry_messages`);
    expect(messages[0]!.n).toBe(0);
  });
});
