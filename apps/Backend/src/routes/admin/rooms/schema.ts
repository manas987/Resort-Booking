import { z } from 'zod';
import { POLICY } from '../../../core/policy.ts';

const dateString = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Expected YYYY-MM-DD.');

export const roomWindowQuerySchema = z
  .object({
    from: dateString.optional(),
    to: dateString.optional(),
  })
  .refine((v) => (v.from && v.to ? v.to > v.from : true), { message: 'to must be after from.', path: ['to'] })
  .refine(
    (v) => {
      if (!v.from || !v.to) return true;
      const days = (new Date(`${v.to}T00:00:00Z`).getTime() - new Date(`${v.from}T00:00:00Z`).getTime()) / 86_400_000;
      return days <= POLICY.pagination.maxRangeDays;
    },
    { message: `Window cannot exceed ${POLICY.pagination.maxRangeDays} days.`, path: ['to'] },
  );
