import { z } from 'zod';

const preferredDatesSchema = z.union([
  z.object({ type: z.literal('exact'), checkIn: z.string(), checkOut: z.string() }),
  z.object({ type: z.literal('month'), month: z.string() }),
  z.object({ type: z.literal('flexible'), notes: z.string().max(500) }),
]);

export const createEventEnquirySchema = z
  .object({
    eventType: z.enum(['wedding', 'offsite']),
    preferredDates: preferredDatesSchema,
    guestCount: z.coerce.number().int().min(1),
    roomsNeeded: z.coerce.number().int().min(1),
    nights: z.coerce.number().int().min(1),
    budgetPaise: z.coerce.number().int().min(0).optional(),
    requirements: z.string().trim().max(2000).optional(),
    contactName: z.string().trim().min(1).max(200),
    contactEmail: z.string().trim().email().optional(),
    contactPhone: z.string().trim().min(6).max(20).optional(),
  })
  .refine((v) => Boolean(v.contactEmail || v.contactPhone), {
    message: 'At least one of contactEmail or contactPhone is required.',
  });
export type CreateEventEnquiryInput = z.infer<typeof createEventEnquirySchema>;
