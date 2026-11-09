import type { Job } from '../../core/jobs.ts';
import { refundLatePayment } from '../../core/booking.ts';

export async function handle(job: Job): Promise<void> {
  const { paymentId } = job.payload as { paymentId: string };
  await refundLatePayment(paymentId);
}
