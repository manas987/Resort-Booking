/**
 * `processEnquiry`'s fixed contract always runs the whole pipeline (classify through draft)
 * — there is no "draft only" entry point. This handler and `classifyEnquiry`'s are therefore
 * identical thin wrappers; the two job *types* exist to say why the pipeline ran
 * (initial classification vs. an explicit regenerate/retry from `admin/enquiryDrafts`), which
 * matters for observability even though the work performed is the same (Docs/03-decisions.md).
 */
import type { Job } from '../../core/jobs.ts';
import { processEnquiry } from '../../core/enquiry/processing.ts';

export async function handle(job: Job): Promise<void> {
  const { enquiryId } = job.payload as { enquiryId: string };
  await processEnquiry(enquiryId);
}
