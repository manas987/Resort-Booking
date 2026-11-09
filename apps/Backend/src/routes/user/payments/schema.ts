import { z } from 'zod';

export const createPaymentAttemptSchema = z.object({
  outcome: z.enum(['succeed', 'decline', 'succeed_late']).optional(),
});
export type CreatePaymentAttemptInput = z.infer<typeof createPaymentAttemptSchema>;
