/**
 * Two payload kinds share this job type. `late_refund_apology` (1H) has no real message row
 * to update — the job row itself, at-most-once via `dedupe_key`, IS the delivery record.
 * `enquiry_reply` (2C) delivers a real `enquiry_messages` row and, only on success, stamps
 * `first_staff_reply_at` — a failed delivery is never a reply (INV-26, INV-54).
 */
import type { Job } from '../../core/jobs.ts';
import { withTransaction } from '../../db.ts';
import { deliverMessage } from '../../adapters/messaging.ts';

export async function handle(job: Job): Promise<void> {
  const payload = job.payload as { kind?: string; messageId?: string; enquiryId?: string; channel?: string };
  if (payload.kind !== 'enquiry_reply') return;

  const { messageId, enquiryId, channel } = payload as { messageId: string; enquiryId: string; channel: 'website' | 'email' | 'whatsapp' };
  const result = await deliverMessage({ messageId, channel });

  await withTransaction(async (client) => {
    await client.query(
      `UPDATE enquiry_messages
          SET delivery_status = $1, delivery_error = $2,
              delivered_at = CASE WHEN $1 = 'sent' THEN now() ELSE NULL END
        WHERE id = $3`,
      [result.status, result.error ?? null, messageId],
    );
    if (result.status === 'sent') {
      await client.query(
        `UPDATE enquiries SET first_staff_reply_at = COALESCE(first_staff_reply_at, now()), last_activity_at = now()
           WHERE id = $1`,
        [enquiryId],
      );
    }
  });
}
