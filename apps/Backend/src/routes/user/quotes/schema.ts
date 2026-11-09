import { z } from 'zod';
import { POLICY } from '../../../core/policy.ts';

const dateString = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Expected YYYY-MM-DD.');

function resortToday(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: POLICY.timezone }).format(new Date());
}
function nightsBetween(checkIn: string, checkOut: string): number {
  const ms = new Date(`${checkOut}T00:00:00Z`).getTime() - new Date(`${checkIn}T00:00:00Z`).getTime();
  return Math.round(ms / 86_400_000);
}

const roomSelectionSchema = z.object({
  roomTypeId: z.string().uuid(),
  adults: z.coerce.number().int().min(1),
  children: z.coerce.number().int().min(0),
});

export const createQuoteSchema = z
  .object({
    checkIn: dateString,
    checkOut: dateString,
    rooms: z.array(roomSelectionSchema).min(1).max(POLICY.stay.maxRoomsPerBooking),
    promoCode: z.string().trim().min(1).max(50).optional(),
  })
  .refine((v) => v.checkOut > v.checkIn, { message: 'checkOut must be after checkIn.' })
  .refine((v) => nightsBetween(v.checkIn, v.checkOut) <= POLICY.stay.maxNightsPerBooking, {
    message: `A stay cannot exceed ${POLICY.stay.maxNightsPerBooking} nights.`,
  })
  // The lower half of the booking horizon (Docs/03-decisions.md, "Booking horizon"). Same
  // rule, same wording as `routes/user/availability/schema.ts` — it was only ever on the
  // availability read, so a quote (and therefore a hold) could be priced and sold for a stay
  // that had already happened.
  .refine((v) => v.checkIn >= resortToday(), { message: 'checkIn cannot be in the past.' })
  .refine(
    (v) => {
      const horizon = new Date(`${resortToday()}T00:00:00Z`);
      horizon.setUTCDate(horizon.getUTCDate() + POLICY.stay.bookingHorizonDays);
      return v.checkIn <= horizon.toISOString().slice(0, 10);
    },
    { message: `checkIn must be within ${POLICY.stay.bookingHorizonDays} days.` },
  );
export type CreateQuoteInput = z.infer<typeof createQuoteSchema>;
