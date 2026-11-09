/**
 * Separate process entry; never starts the HTTP server. Claims with FOR UPDATE SKIP LOCKED,
 * bounded retries with backoff, reclaims work abandoned by a crashed worker (INV-24).
 */
import { randomUUID } from 'node:crypto';
import { claimJobs, completeJob, failJob } from '../core/jobs.ts';
import type { Job, JobType } from '../core/jobs.ts';
import { POLICY } from '../core/policy.ts';
import { handle as handleExpireHolds } from './handlers/expireHolds.ts';
import { handle as handleProcessPaymentEvent } from './handlers/processPaymentEvent.ts';
import { handle as handleRefundLatePayment } from './handlers/refundLatePayment.ts';
import { handle as handleSendMessage } from './handlers/sendMessage.ts';
import { handle as handleClassifyEnquiry } from './handlers/classifyEnquiry.ts';
import { handle as handleDraftEnquiryReply } from './handlers/draftEnquiryReply.ts';

type Handler = (job: Job) => Promise<void>;

const HANDLERS: Partial<Record<JobType, Handler>> = {
  expire_holds: handleExpireHolds,
  process_payment_event: handleProcessPaymentEvent,
  refund_late_payment: handleRefundLatePayment,
  send_message: handleSendMessage,
  classify_enquiry: handleClassifyEnquiry,
  draft_enquiry_reply: handleDraftEnquiryReply,
};

/** Claims up to `limit` ready jobs and runs each to completion or failure. Exported
 *  separately from the poll loop so tests can process a known batch deterministically,
 *  without a real timer (Docs/09-test-harness.md: never patch the clock). */
export async function processBatch(workerId: string, limit = POLICY.jobs.claimBatchSize): Promise<number> {
  const jobs = await claimJobs({ workerId, limit });
  for (const job of jobs) {
    const handler = HANDLERS[job.type];
    try {
      if (!handler) throw new Error(`No handler registered for job type "${job.type}".`);
      await handler(job);
      await completeJob(job.id);
    } catch (error) {
      await failJob(job.id, error instanceof Error ? error.message : String(error));
    }
  }
  return jobs.length;
}

async function pollForever(): Promise<void> {
  const workerId = randomUUID();
  console.log(`[worker] ${workerId} starting, polling every ${POLICY.jobs.pollIntervalMs}ms`);
  for (;;) {
    try {
      await processBatch(workerId);
    } catch (error) {
      console.error('[worker] batch failed', (error as Error).message);
    }
    await new Promise((resolve) => setTimeout(resolve, POLICY.jobs.pollIntervalMs));
  }
}

if (import.meta.main) {
  pollForever();
}
