/**
 * JR-1..JR-6 (Docs/tests-phase1.md, 1H).
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'bun:test';
import type { AddressInfo } from 'node:net';
import { createApp } from '../src/app.ts';
import { pool, withTransaction } from '../src/db.ts';
import { requireTestDatabase, resetDatabase } from './helpers/db.ts';
import { createRoomType, futureDate, publishResortInfo, createGuest } from './helpers/factories.ts';
import { enqueueJob } from '../src/core/jobs.ts';
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

describe('jobs.recovery — 1H', () => {
  it('JR-1: a stale lock (worker killed mid-handler) is reclaimed and completed on restart (INV-24)', async () => {
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
      { quoteId, guestName: 'JR1', guestEmail: 'jr1@example.com', guestPhone: '9000000000' },
      guest.accessToken,
      crypto.randomUUID(),
    );
    const { bookingId } = (await bookingResponse.json()) as { bookingId: string };
    await pool.query(`UPDATE bookings SET hold_expires_at = now() - interval '1 second' WHERE id = $1`, [bookingId]);

    // Simulate a worker that claimed the job, then died mid-handler: locked, never completed.
    // run_after also needs to have arrived — it was stamped at hold time, well in the future.
    await pool.query(
      `UPDATE jobs SET locked_at = now() - interval '1 hour', locked_by = 'dead-worker', run_after = now()
         WHERE type = 'expire_holds' AND dedupe_key = $1`,
      [`expire_holds:${bookingId}`],
    );

    const processed = await processBatch('new-worker');
    expect(processed).toBeGreaterThan(0);
    const { rows } = await pool.query<{ status: string }>(`SELECT status FROM bookings WHERE id = $1`, [bookingId]);
    expect(rows[0]!.status).toBe('expired');
  });

  it('JR-2: two workers claiming concurrently never run the same job twice (FOR UPDATE SKIP LOCKED)', async () => {
    const dedupeKeys: string[] = [];
    await withTransaction(async (client) => {
      for (let i = 0; i < 6; i += 1) {
        const key = `jr2-${i}-${crypto.randomUUID()}`;
        dedupeKeys.push(key);
        await enqueueJob(client, { type: 'send_message', payload: { kind: 'test', i }, dedupeKey: key });
      }
    });

    const [a, b] = await Promise.all([processBatch('worker-a', 10), processBatch('worker-b', 10)]);
    expect(a + b).toBe(6); // split across the two, never overlapping

    const { rows } = await pool.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM jobs WHERE dedupe_key = ANY($1) AND completed_at IS NOT NULL`,
      [dedupeKeys],
    );
    expect(rows[0]!.n).toBe(6);
  });

  it('JR-3: a handler that keeps throwing is retried a bounded number of times, then failed_at is set', async () => {
    // A non-UUID bookingId makes the handler's own query throw deterministically, with no
    // injected test seam in production code — the database itself refuses the value.
    await withTransaction((client) =>
      enqueueJob(client, {
        type: 'expire_holds',
        payload: { bookingId: 'not-a-uuid' },
        dedupeKey: 'jr3-always-fails',
        maxAttempts: 2,
      }),
    );

    await processBatch('jr3-worker'); // attempt 1 — fails
    let row = (await pool.query<{ attempts: number; failed_at: string | null }>(
      `SELECT attempts, failed_at FROM jobs WHERE dedupe_key = 'jr3-always-fails'`,
    )).rows[0]!;
    expect(row.attempts).toBe(1);
    expect(row.failed_at).toBeNull();

    await pool.query(`UPDATE jobs SET run_after = now() WHERE dedupe_key = 'jr3-always-fails'`); // skip the backoff wait
    await processBatch('jr3-worker'); // attempt 2 — exhausts max_attempts
    row = (await pool.query<{ attempts: number; failed_at: string | null }>(
      `SELECT attempts, failed_at FROM jobs WHERE dedupe_key = 'jr3-always-fails'`,
    )).rows[0]!;
    expect(row.attempts).toBe(2);
    expect(row.failed_at).not.toBeNull();

    await pool.query(`UPDATE jobs SET run_after = now() WHERE dedupe_key = 'jr3-always-fails'`);
    const processedAfterFailure = await processBatch('jr3-worker'); // never claimed again
    expect(processedAfterFailure).toBe(0);
  });

  it('JR-4: a dedupe_key enqueued twice produces one row — at-most-once', async () => {
    await withTransaction(async (client) => {
      await enqueueJob(client, { type: 'send_message', payload: {}, dedupeKey: 'jr4-once' });
      await enqueueJob(client, { type: 'send_message', payload: {}, dedupeKey: 'jr4-once' });
    });
    const { rows } = await pool.query<{ n: number }>(`SELECT count(*)::int AS n FROM jobs WHERE dedupe_key = 'jr4-once'`);
    expect(rows[0]!.n).toBe(1);
  });

  it('JR-5: a rolled-back business transaction leaves no job row — the enqueue was inside it (INV-23)', async () => {
    await expect(
      withTransaction(async (client) => {
        await enqueueJob(client, { type: 'send_message', payload: {}, dedupeKey: 'jr5-never-committed' });
        throw new Error('simulate a failure after enqueueing, before commit');
      }),
    ).rejects.toThrow();

    const { rows } = await pool.query<{ n: number }>(`SELECT count(*)::int AS n FROM jobs WHERE dedupe_key = 'jr5-never-committed'`);
    expect(rows[0]!.n).toBe(0);
  });

  it('JR-6: a lapsed hold frees inventory even if the worker never runs at all (INV-10)', async () => {
    const room = await createRoomType({ baseAllotment: 1, physicalStock: 1 });
    const checkIn = futureDate(10);
    const checkOut = futureDate(11);
    const guestA = await createGuest();
    const guestB = await createGuest();

    const quoteA = await post('/api/user/quotes', { checkIn, checkOut, rooms: [{ roomTypeId: room.id, adults: 1, children: 0 }] });
    const { quoteId: quoteIdA } = (await quoteA.json()) as { quoteId: string };
    const bookingA = await post(
      '/api/user/bookings',
      { quoteId: quoteIdA, guestName: 'A', guestEmail: 'jr6a@example.com', guestPhone: '9000000000' },
      guestA.accessToken,
      crypto.randomUUID(),
    );
    const { bookingId } = (await bookingA.json()) as { bookingId: string };
    // Lapse it directly — no worker, no expireBookingHold call, nothing processes this job.
    await pool.query(`UPDATE bookings SET hold_expires_at = now() - interval '1 second' WHERE id = $1`, [bookingId]);

    const quoteB = await post('/api/user/quotes', { checkIn, checkOut, rooms: [{ roomTypeId: room.id, adults: 1, children: 0 }] });
    const { quoteId: quoteIdB } = (await quoteB.json()) as { quoteId: string };
    const bookingB = await post(
      '/api/user/bookings',
      { quoteId: quoteIdB, guestName: 'B', guestEmail: 'jr6b@example.com', guestPhone: '9000000000' },
      guestB.accessToken,
      crypto.randomUUID(),
    );
    expect(bookingB.status).toBe(201); // the "sold" room is free the instant it lapses
  });
});
