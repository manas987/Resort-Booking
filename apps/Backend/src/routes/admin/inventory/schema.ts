import { z } from 'zod';
import { POLICY } from '../../../core/policy.ts';

const dateString = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Expected YYYY-MM-DD.');

// from/to are both INCLUSIVE here — a calendar range an admin picks ("20-31 Dec"), unlike a
// stay's exclusive checkout (Docs/03-decisions.md).
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

export const readInventoryQuerySchema = withRangeBounds(rangeFields);

export const updateBaseAllotmentSchema = z.object({ baseAllotment: z.number().int().min(0) });

export const previewAllotmentSchema = withRangeBounds({
  ...rangeFields,
  // null previews removing the override (revert to base) — the same range identifies the
  // touched rows either way; only the conflict check's target value differs.
  allotment: z.number().int().min(0).nullable(),
});

export const applyAllotmentSchema = withRangeBounds({
  ...rangeFields,
  allotment: z.number().int().min(0),
  previewToken: z.string().min(1),
});

export const removeAllotmentSchema = withRangeBounds({
  ...rangeFields,
  previewToken: z.string().min(1),
});
