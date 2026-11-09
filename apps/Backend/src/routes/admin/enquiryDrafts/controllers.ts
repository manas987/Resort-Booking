import type { NextFunction, Request, Response } from 'express';
import { pool, withTransaction } from '../../../db.ts';
import { notFound } from '../../../middleware/errors.ts';
import type { Principal } from '../../../core/tokens.ts';
import { enqueueJob } from '../../../core/jobs.ts';
import { processEnquiry } from '../../../core/enquiry/processing.ts';

async function assertAssignedOrAbove(principal: Principal, enquiryId: string): Promise<void> {
  const scoped = principal.role === 'gm' || principal.role === 'owner';
  const params = scoped ? [enquiryId] : [enquiryId, principal.userId];
  const { rows } = await pool.query<{ id: string }>(
    `SELECT id FROM enquiries WHERE id = $1 AND (${scoped ? 'TRUE' : 'assignee_id = $2'})`,
    params,
  );
  if (!rows[0]) throw notFound('Enquiry');
}

/** Generates or regenerates — queued through the worker like the initial classification
 *  (Docs/06-touch-map.md: `processEnquiry`'s caller here is `jobs/handlers/draftEnquiryReply`,
 *  not this controller directly). `processEnquiry` itself supersedes any still-pending draft
 *  when it runs, so there is nothing else to enqueue or coordinate. */
export async function generateEnquiryDraftController(request: Request, response: Response, next: NextFunction): Promise<void> {
  const principal = response.locals.principal as Principal;
  const { enquiryId } = request.params as { enquiryId: string };
  try {
    await assertAssignedOrAbove(principal, enquiryId);
    await withTransaction((client) => enqueueJob(client, { type: 'draft_enquiry_reply', payload: { enquiryId } }));
    response.status(202).json({ enquiryId, status: 'queued' });
  } catch (error) {
    next(error);
  }
}

/** The bounded retry of a failed stage runs synchronously — the staff member is already
 *  looking at a visible failure and waiting on the result, unlike the fire-and-forget initial
 *  classification. `processEnquiry` bounds its own provider retries internally
 *  (POLICY.ai.maxAttempts); this is the human-initiated re-run after those were exhausted. */
export async function retryEnquiryAiController(request: Request, response: Response, next: NextFunction): Promise<void> {
  const principal = response.locals.principal as Principal;
  const { enquiryId } = request.params as { enquiryId: string };
  try {
    await assertAssignedOrAbove(principal, enquiryId);
    const outcome = await processEnquiry(enquiryId);
    response.status(200).json(outcome);
  } catch (error) {
    next(error);
  }
}
