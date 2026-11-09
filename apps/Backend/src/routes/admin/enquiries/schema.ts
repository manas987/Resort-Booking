import { z } from 'zod';
import { POLICY } from '../../../core/policy.ts';

const boolQuery = z
  .enum(['true', 'false'])
  .optional()
  .transform((v) => (v === undefined ? undefined : v === 'true'));

// Sorts come from a fixed allowlist — never interpolated from the request (IB-4, IB-5).
// Any other value, including a SQL fragment, simply fails this enum.
const sortSchema = z.enum(['last_activity_at', 'created_at']).default('last_activity_at');

export const listEnquiriesQuerySchema = z.object({
  status: z.enum(['new', 'in_progress', 'awaiting_guest', 'resolved']).optional(),
  category: z.enum(['room', 'wedding', 'offsite', 'complaint']).optional(),
  source: z.enum(['website', 'email', 'whatsapp']).optional(),
  assignee: z.string().uuid().optional(),
  /** Threads raised against one booking — what the Bookings drawer's "Open related enquiry"
   *  link resolves. Scoping still applies on top (INV-38), so staff see only their own. */
  bookingId: z.string().uuid().optional(),
  complaint: boolQuery,
  needsReview: boolQuery,
  unassigned: boolQuery,
  search: z.string().trim().min(1).max(200).optional(),
  sort: sortSchema,
  limit: z.coerce.number().int().min(1).max(POLICY.pagination.maxLimit).default(POLICY.pagination.defaultLimit),
  cursor: z.string().optional(),
});
export type ListEnquiriesQuery = z.infer<typeof listEnquiriesQuerySchema>;

export const enquiryDetailQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(POLICY.pagination.maxLimit).default(POLICY.pagination.defaultLimit),
  cursor: z.string().optional(),
});

export const updateCategorySchema = z.object({
  category: z.enum(['room', 'wedding', 'offsite', 'complaint']),
});

export const updateStatusSchema = z.object({
  status: z.enum(['new', 'in_progress', 'resolved']),
});
