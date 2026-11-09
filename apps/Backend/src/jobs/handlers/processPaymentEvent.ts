import type { Job } from '../../core/jobs.ts';
import { confirmMockPayment } from '../../core/booking.ts';

export async function handle(job: Job): Promise<void> {
  const { paymentId, eventKey, eventType } = job.payload as {
    paymentId: string;
    eventKey: string;
    eventType: 'succeeded' | 'failed' | 'late_success';
  };
  await confirmMockPayment({ paymentId, eventKey, eventType });
}
