import type { Job } from '../../core/jobs.ts';
import { processEnquiry } from '../../core/enquiry/processing.ts';

export async function handle(job: Job): Promise<void> {
  const { enquiryId } = job.payload as { enquiryId: string };
  await processEnquiry(enquiryId);
}
