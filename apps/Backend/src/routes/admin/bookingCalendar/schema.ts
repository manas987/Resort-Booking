import { z } from 'zod';
import { POLICY } from '../../../core/policy.ts';

const dateString = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Expected YYYY-MM-DD.');

export const calendarQuerySchema = z
  .object({
    from: dateString,
    to: dateString,
    roomTypeId: z.string().uuid().optional(),
  })
  .refine((v) => v.to > v.from, { message: 'to must be after from.', path: ['to'] })
  .refine(
    (v) => (new Date(`${v.to}T00:00:00Z`).getTime() - new Date(`${v.from}T00:00:00Z`).getTime()) / 86_400_000 <= POLICY.pagination.maxRangeDays,
    { message: `Window cannot exceed ${POLICY.pagination.maxRangeDays} days.`, path: ['to'] },
  );
