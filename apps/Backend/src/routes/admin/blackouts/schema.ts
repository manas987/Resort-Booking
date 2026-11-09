import { z } from 'zod';
import { POLICY } from '../../../core/policy.ts';

const dateString = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Expected YYYY-MM-DD.');
const rangeFields = { roomTypeId: z.string().uuid(), from: dateString, to: dateString };

function withRangeBounds<T extends z.ZodRawShape>(shape: T) {
  return z.object(shape).refine(
    (parsed) => {
      const v = parsed as { from: string; to: string };
      if (v.to < v.from) return false;
      const days = (new Date(`${v.to}T00:00:00Z`).getTime() - new Date(`${v.from}T00:00:00Z`).getTime()) / 86_400_000;
      return days <= POLICY.pagination.maxRangeDays;
    },
    { message: `to must be on or after from, and the range cannot exceed ${POLICY.pagination.maxRangeDays} days.`, path: ['to'] },
  );
}

export const readBlackoutsQuerySchema = withRangeBounds(rangeFields);
export const previewBlackoutSchema = withRangeBounds(rangeFields);
export const applyBlackoutSchema = withRangeBounds({ ...rangeFields, previewToken: z.string().min(1) });
export const removeBlackoutSchema = withRangeBounds({ ...rangeFields, previewToken: z.string().min(1) });
