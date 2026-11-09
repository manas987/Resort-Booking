import { z } from 'zod';
import { POLICY } from '../../../core/policy.ts';

export const createBookingSchema = z.object({
  quoteId: z.string().uuid(),
  guestName: z.string().trim().min(1).max(200),
  guestEmail: z.string().trim().email(),
  guestPhone: z.string().trim().min(6).max(20),
});
export type CreateBookingInput = z.infer<typeof createBookingSchema>;

export const listBookingsQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(POLICY.pagination.maxLimit).default(POLICY.pagination.defaultLimit),
  cursor: z.string().optional(),
});
export type ListBookingsQuery = z.infer<typeof listBookingsQuerySchema>;
