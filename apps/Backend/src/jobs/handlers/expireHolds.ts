import type { Job } from '../../core/jobs.ts';
import { expireBookingHold } from '../../core/booking.ts';

export async function handle(job: Job): Promise<void> {
  const { bookingId } = job.payload as { bookingId: string };
  await expireBookingHold(bookingId);
}
