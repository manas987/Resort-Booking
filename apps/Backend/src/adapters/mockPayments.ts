/**
 * Mock provider behaviour and ledger event shapes (Docs/04-contracts.md). The browser never
 * decides a booking is paid — `outcome` is honoured only under DEMO_MODE (INV-25).
 */
import { randomUUID } from 'node:crypto';
import type { Tx } from '../db.ts';
import { env } from '../env.ts';
import { enqueueJob } from '../core/jobs.ts';

export type MockOutcome = 'succeed' | 'decline' | 'succeed_late';

/** Creates the payment attempt row and the ledger event the server will process.
 *  `outcome` is honoured ONLY when env.DEMO_MODE is true; otherwise it is ignored and
 *  'succeed' is used (INV-25). */
export async function beginPaymentAttempt(
  client: Tx,
  input: { bookingId: string; amountPaise: number; outcome?: MockOutcome },
): Promise<{ paymentId: string; providerRef: string }> {
  const outcome: MockOutcome = env.DEMO_MODE ? input.outcome ?? 'succeed' : 'succeed';

  const { rows: countRows } = await client.query<{ next_attempt: number }>(
    `SELECT COALESCE(max(attempt_no), 0) + 1 AS next_attempt FROM payments WHERE booking_id = $1`,
    [input.bookingId],
  );
  const providerRef = randomUUID();
  const { rows: paymentRows } = await client.query<{ id: string }>(
    `INSERT INTO payments (booking_id, attempt_no, status, amount_paise, provider_ref)
     VALUES ($1, $2, 'processing', $3, $4)
     RETURNING id`,
    [input.bookingId, countRows[0]!.next_attempt, input.amountPaise, providerRef],
  );
  const paymentId = paymentRows[0]!.id;

  const eventType = outcome === 'decline' ? 'failed' : outcome === 'succeed_late' ? 'late_success' : 'succeeded';
  const eventKey = randomUUID();
  await client.query(
    `INSERT INTO payment_events (payment_id, event_key, type) VALUES ($1, $2, $3)`,
    [paymentId, eventKey, eventType],
  );

  let runAfter: string | undefined;
  if (outcome === 'succeed_late') {
    const { rows: bookingRows } = await client.query<{ hold_expires_at: string | null }>(
      `SELECT hold_expires_at FROM bookings WHERE id = $1`,
      [input.bookingId],
    );
    const holdExpiresAt = bookingRows[0]?.hold_expires_at;
    // Scheduled to land after the hold has already lapsed, so the "late" half of the
    // lifecycle is genuinely exercised, not just labelled.
    runAfter = holdExpiresAt
      ? new Date(new Date(holdExpiresAt).getTime() + 1_000).toISOString()
      : undefined;
  }

  await enqueueJob(client, {
    type: 'process_payment_event',
    payload: { paymentId, eventKey, eventType },
    runAfter,
    dedupeKey: eventKey,
  });

  return { paymentId, providerRef };
}
