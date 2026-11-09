import { z } from 'zod';
import { POLICY } from '../../../core/policy.ts';

export const createEnquirySchema = z.object({
  message: z.string().trim().min(1).max(4000),
});
export type CreateEnquiryInput = z.infer<typeof createEnquirySchema>;

export const listEnquiriesQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(POLICY.pagination.maxLimit).default(POLICY.pagination.defaultLimit),
  cursor: z.string().optional(),
});
export type ListEnquiriesQuery = z.infer<typeof listEnquiriesQuerySchema>;

export const createBookingEnquirySchema = z.object({
  message: z.string().trim().min(1).max(4000),
});
export type CreateBookingEnquiryInput = z.infer<typeof createBookingEnquirySchema>;
