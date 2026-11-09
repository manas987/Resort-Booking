import { z } from 'zod';
import { POLICY } from '../../../core/policy.ts';

export const listBookingsQuerySchema = z.object({
  status: z.enum(['pending_payment', 'confirmed', 'payment_failed', 'expired']).optional(),
  search: z.string().trim().min(1).max(200).optional(), // matches reference or guest email/name
  limit: z.coerce.number().int().min(1).max(POLICY.pagination.maxLimit).default(POLICY.pagination.defaultLimit),
  cursor: z.string().optional(),
});
