import { z } from 'zod';
import { POLICY } from '../../../core/policy.ts';

const dateString = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Expected YYYY-MM-DD.');

export const listBookingsQuerySchema = z
  .object({
    status: z.enum(['pending_payment', 'confirmed', 'payment_failed', 'expired']).optional(),
    search: z.string().trim().min(1).max(200).optional(), // matches reference or guest email/name
    /** Confirmation-date window, resolved in POLICY.timezone — the same basis as the CSV export
     *  (§21), so a reported total and an exported file for one range agree. Unconfirmed bookings
     *  have no confirmed_at and are excluded whenever either bound is supplied. */
    confirmedFrom: dateString.optional(),
    confirmedTo: dateString.optional(),
    limit: z.coerce.number().int().min(1).max(POLICY.pagination.maxLimit).default(POLICY.pagination.defaultLimit),
    cursor: z.string().optional(),
  })
  .refine((v) => !(v.confirmedFrom && v.confirmedTo) || v.confirmedTo >= v.confirmedFrom, {
    message: 'confirmedTo must be on or after confirmedFrom.',
    path: ['confirmedTo'],
  });
