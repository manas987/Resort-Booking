import { z } from 'zod';
import { POLICY } from '../../../core/policy.ts';

const dateString = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Expected YYYY-MM-DD.');

/** "Today" in the resort's own timezone — a browser's local date is not this (00-conventions.md). */
function resortToday(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: POLICY.timezone }).format(new Date());
}

export const availabilityQuerySchema = z
  .object({
    checkIn: dateString,
    checkOut: dateString,
    adults: z.coerce.number().int().min(1).default(1),
    children: z.coerce.number().int().min(0).default(0),
    rooms: z.coerce.number().int().min(1).max(POLICY.stay.maxRoomsPerBooking).default(1),
  })
  .refine((v) => v.checkOut > v.checkIn, { message: 'checkOut must be after checkIn.' })
  .refine((v) => v.checkIn >= resortToday(), { message: 'checkIn cannot be in the past.' })
  .refine(
    (v) => {
      const horizon = new Date(`${resortToday()}T00:00:00Z`);
      horizon.setUTCDate(horizon.getUTCDate() + POLICY.stay.bookingHorizonDays);
      return v.checkIn <= horizon.toISOString().slice(0, 10);
    },
    { message: `checkIn must be within ${POLICY.stay.bookingHorizonDays} days.` },
  );
export type AvailabilityQuery = z.infer<typeof availabilityQuerySchema>;

/** GET /availability/calendar — per-date rows for one room type, for the availability-calendar
 *  panel (Docs/14-frontend-api-map.md). Same horizon as above, both halves (pre-publish
 *  review: a window check with only one end is how a 30-days-in-the-past window got through
 *  on /quotes before). `calendarMaxDays` is a UI payload cap, not the admin list-range figure
 *  in POLICY.pagination — a display-only guest read never hands back 366 daily rows. */
export const availabilityCalendarQuerySchema = z
  .object({
    slug: z.string().min(1).max(200),
    from: dateString,
    to: dateString,
  })
  .refine((v) => v.to > v.from, { message: 'to must be after from.' })
  .refine((v) => v.from >= resortToday(), { message: 'from cannot be in the past.' })
  .refine(
    (v) => {
      const horizon = new Date(`${resortToday()}T00:00:00Z`);
      horizon.setUTCDate(horizon.getUTCDate() + POLICY.stay.bookingHorizonDays);
      return v.from <= horizon.toISOString().slice(0, 10);
    },
    { message: `from must be within ${POLICY.stay.bookingHorizonDays} days.` },
  )
  .refine(
    (v) => {
      const days = Math.round((Date.parse(v.to) - Date.parse(v.from)) / 86_400_000);
      return days <= POLICY.availability.calendarMaxDays;
    },
    { message: `The window cannot exceed ${POLICY.availability.calendarMaxDays} days.` },
  );
export type AvailabilityCalendarQuery = z.infer<typeof availabilityCalendarQuerySchema>;
