import { z } from 'zod';

export const recordAnalyticsEventSchema = z.object({
  anonId: z.string().trim().min(1).max(100),
  sessionId: z.string().trim().min(1).max(100),
  type: z.enum(['visit', 'search', 'checkout_started', 'booking_confirmed', 'enquiry_submitted']),
  dedupeKey: z.string().trim().min(1).max(200).optional(),
  payload: z.record(z.string(), z.unknown()).optional(),
});
export type RecordAnalyticsEventInput = z.infer<typeof recordAnalyticsEventSchema>;
