import type { NextFunction, Request, Response } from 'express';
import { pool } from '../../../db.ts';
import { badRequest, notFound } from '../../../middleware/errors.ts';
import { POLICY } from '../../../core/policy.ts';
import { readAvailability } from '../../../core/inventory.ts';
import { availabilityQuerySchema, availabilityCalendarQuerySchema } from './schema.ts';

type RoomTypeRow = {
  id: string;
  slug: string;
  name: string;
  max_adults: number;
  max_children: number;
  max_occupancy: number;
  base_price_paise: number;
};

/** Never a precise booking-time check (that is `calculateQuote`/`assertAvailable`'s job) —
 *  just enough to tell a browsing guest which room types could possibly work, assuming an
 *  even split of the party across the rooms they asked for. */
function fitsOccupancy(roomType: RoomTypeRow, adults: number, children: number, rooms: number): boolean {
  const perRoomAdults = Math.ceil(adults / rooms);
  const perRoomChildren = Math.ceil(children / rooms);
  return (
    perRoomAdults >= POLICY.stay.minAdultsPerRoom &&
    perRoomAdults <= roomType.max_adults &&
    perRoomChildren <= roomType.max_children &&
    perRoomAdults + perRoomChildren <= roomType.max_occupancy
  );
}

/** `GET /availability` — never served from a cache (CR-10, INV-1): stale availability must
 *  never be what lets a booking through. `assertAvailable` under lock is the real authority;
 *  this is display only. */
export async function readAvailabilityController(
  request: Request,
  response: Response,
  next: NextFunction,
): Promise<void> {
  const parsed = availabilityQuerySchema.safeParse(request.query);
  if (!parsed.success) return next(badRequest(parsed.error));
  const { checkIn, checkOut, adults, children, rooms } = parsed.data;

  try {
    const { rows: roomTypes } = await pool.query<RoomTypeRow>(
      `SELECT id, slug, name, max_adults, max_children, max_occupancy, base_price_paise
         FROM room_types WHERE is_active ORDER BY sort_order, name`,
    );

    const availability = await readAvailability(pool, {
      stay: { checkIn, checkOut },
      roomTypeIds: roomTypes.map((r) => r.id),
    });
    const remainingByRoomType = new Map<string, number>();
    for (const night of availability) {
      const current = remainingByRoomType.get(night.roomTypeId);
      remainingByRoomType.set(
        night.roomTypeId,
        current === undefined ? night.remaining : Math.min(current, night.remaining),
      );
    }

    response.setHeader('Cache-Control', 'no-store');
    response.status(200).json({
      checkIn,
      checkOut,
      rooms: roomTypes.map((roomType) => {
        if (!fitsOccupancy(roomType, adults, children, rooms)) {
          return {
            roomTypeId: roomType.id,
            slug: roomType.slug,
            name: roomType.name,
            available: false,
            reason: 'occupancy',
          };
        }
        const remaining = remainingByRoomType.get(roomType.id) ?? 0;
        return {
          roomTypeId: roomType.id,
          slug: roomType.slug,
          name: roomType.name,
          available: remaining >= rooms,
          reason: remaining >= rooms ? undefined : 'sold_out',
          remaining,
          fromPricePaise: roomType.base_price_paise,
        };
      }),
    });
  } catch (error) {
    next(error);
  }
}

/** `GET /availability/calendar` — per-date rows for one room type (Docs/14-frontend-api-map.md).
 *  `GET /availability` above only ever returns one number for the whole stay (the minimum
 *  across nights); this is the endpoint the availability-calendar panel actually needs.
 *  Reuses `readAvailability` for remaining/blackout — never served from a cache (INV-1), same
 *  reasoning as CR-10 above. */
export async function readAvailabilityCalendarController(
  request: Request,
  response: Response,
  next: NextFunction,
): Promise<void> {
  const parsed = availabilityCalendarQuerySchema.safeParse(request.query);
  if (!parsed.success) return next(badRequest(parsed.error));
  const { slug, from, to } = parsed.data;

  try {
    const { rows } = await pool.query<{ id: string; base_price_paise: number }>(
      `SELECT id, base_price_paise FROM room_types WHERE slug = $1 AND is_active`,
      [slug],
    );
    const roomType = rows[0];
    if (!roomType) return next(notFound('Room type'));

    const nights = await readAvailability(pool, {
      stay: { checkIn: from, checkOut: to },
      roomTypeIds: [roomType.id],
    });

    const { rows: overrides } = await pool.query<{ stay_date: string; price_paise: number }>(
      `SELECT stay_date::text AS stay_date, price_paise FROM room_day
         WHERE room_type_id = $1 AND stay_date >= $2 AND stay_date < $3 AND price_paise IS NOT NULL`,
      [roomType.id, from, to],
    );
    const priceByDate = new Map(overrides.map((row) => [row.stay_date, row.price_paise]));

    response.setHeader('Cache-Control', 'no-store');
    response.status(200).json({
      slug,
      days: nights.map((night) => ({
        date: night.stayDate,
        remaining: night.remaining,
        pricePaise: priceByDate.get(night.stayDate) ?? roomType.base_price_paise,
        isBlackout: night.isBlackout,
      })),
    });
  } catch (error) {
    next(error);
  }
}
