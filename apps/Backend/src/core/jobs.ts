/**
 * `enqueueJob` landed in 1G — there is no hold without an `expire_holds` job. 1H adds
 * `claimJobs`/`completeJob`/`failJob` for the worker (Docs/04-contracts.md).
 */
import type { Tx } from '../db.ts';
import { pool } from '../db.ts';
import { POLICY } from './policy.ts';

export type JobType =
  | 'expire_holds'
  | 'process_payment_event'
  | 'refund_late_payment'
  | 'send_message'
  | 'classify_enquiry'
  | 'draft_enquiry_reply';

/** Takes the client so the job is persisted in the business transaction and only becomes
 *  visible after it commits (INV-23). dedupeKey makes a job at-most-once. */
export async function enqueueJob(
  client: Tx,
  input: {
    type: JobType;
    payload: Record<string, unknown>;
    runAfter?: string;
    dedupeKey?: string;
    maxAttempts?: number;
  },
): Promise<void> {
  await client.query(
    `INSERT INTO jobs (type, payload, dedupe_key, run_after, max_attempts)
     VALUES ($1, $2, $3, COALESCE($4, now()), $5)
     ON CONFLICT (type, dedupe_key) WHERE dedupe_key IS NOT NULL DO NOTHING`,
    [
      input.type,
      JSON.stringify(input.payload),
      input.dedupeKey ?? null,
      input.runAfter ?? null,
      input.maxAttempts ?? POLICY.jobs.defaultMaxAttempts,
    ],
  );
}

export type Job = {
  id: string;
  type: JobType;
  payload: Record<string, unknown>;
  attempts: number;
  maxAttempts: number;
};

type JobRow = {
  id: string;
  type: JobType;
  payload: Record<string, unknown>;
  attempts: number;
  max_attempts: number;
};

/** FOR UPDATE SKIP LOCKED. Also reclaims work whose locked_at is older than the stale
 *  threshold, so a crashed worker's jobs are picked up (INV-24). */
export async function claimJobs(input: { workerId: string; limit: number }): Promise<Job[]> {
  const { rows } = await pool.query<JobRow>(
    `UPDATE jobs SET locked_at = now(), locked_by = $1
       WHERE id IN (
         SELECT id FROM jobs
          WHERE completed_at IS NULL AND failed_at IS NULL
            AND run_after <= now()
            AND (locked_at IS NULL OR locked_at < now() - interval '1 second' * $2)
          ORDER BY run_after
          LIMIT $3
          FOR UPDATE SKIP LOCKED
       )
       RETURNING id, type, payload, attempts, max_attempts`,
    [input.workerId, POLICY.jobs.staleLockSeconds, input.limit],
  );
  return rows.map((r) => ({
    id: r.id,
    type: r.type,
    payload: r.payload,
    attempts: r.attempts,
    maxAttempts: r.max_attempts,
  }));
}

export async function completeJob(jobId: string): Promise<void> {
  await pool.query(`UPDATE jobs SET completed_at = now() WHERE id = $1`, [jobId]);
}

/** Bounded retries with backoff; past maxAttempts sets failed_at so it surfaces to staff. */
export async function failJob(jobId: string, error: string): Promise<void> {
  await pool.query(
    `UPDATE jobs SET
       attempts = attempts + 1,
       last_error = $2,
       locked_at = NULL,
       locked_by = NULL,
       run_after = CASE WHEN attempts + 1 < max_attempts
                        THEN now() + (interval '1 second' * power(2, attempts + 1))
                        ELSE run_after END,
       failed_at = CASE WHEN attempts + 1 >= max_attempts THEN now() ELSE NULL END
     WHERE id = $1`,
    [jobId, error],
  );
}
