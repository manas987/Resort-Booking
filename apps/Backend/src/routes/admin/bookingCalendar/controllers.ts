import type { NextFunction, Request, Response } from 'express';
import { pool } from '../../../db.ts';
import { badRequest } from '../../../middleware/errors.ts';
import { readAvailability } from '../../../core/inventory.ts';
import { calendarQuerySchema } from './schema.ts';

function key(roomTypeId: string, stayDate: string): string {
  return `${roomTypeId}|${stayDate}`;
}

export async function readBookingCalendarController(request: Request, response: Response, next: NextFunction): Promise<void> {
  const parsed = calendarQuerySchema.safeParse(request.query);
  if (!parsed.success) return next(badRequest(parsed.error));
  const { from, to, roomTypeId } = parsed.data;

  try {
    const roomTypeIds = roomTypeId
      ? [roomTypeId]
      : (await pool.query<{ id: string }>(`SELECT id FROM room_types ORDER BY sort_order, name`)).rows.map((r) => r.id);

    // `remaining` and `committed` keep coming from the one shared availability expression
    // (INV-1, INV-10) — never re-derived here. The two reads below only BREAK DOWN what it
    // already counted, and apply the same `confirmed OR live hold` predicate, so
    // confirmed + held === committed by construction.
    const availability = await readAvailability(pool, { stay: { checkIn: from, checkOut: to }, roomTypeIds });

    const { rows: split } = await pool.query<{ room_type_id: string; stay_date: string; confirmed: number; held: number }>(
      `SELECT bn.room_type_id, bn.stay_date::text AS stay_date,
              count(*) FILTER (WHERE b.status = 'confirmed')::int AS confirmed,
              count(*) FILTER (WHERE b.status = 'pending_payment' AND b.hold_expires_at > now())::int AS held
         FROM booking_nights bn
         JOIN bookings b ON b.id = bn.booking_id
        WHERE bn.room_type_id = ANY($1) AND bn.stay_date BETWEEN $2::date AND $3::date
          AND (b.status = 'confirmed' OR (b.status = 'pending_payment' AND b.hold_expires_at > now()))
        GROUP BY bn.room_type_id, bn.stay_date`,
      [roomTypeIds, from, to],
    );
    const splitByNight = new Map(split.map((r) => [key(r.room_type_id, r.stay_date), r]));

    // The nightly rate the staff screens show: the room_day override when one exists, otherwise
    // the room type's base price. Deleting an override nulls the column and the date falls back
    // to base — there is no override-range entity to consult.
    const { rows: priced } = await pool.query<{ room_type_id: string; stay_date: string; price_paise: number | null; base_price_paise: number }>(
      `SELECT rt.id AS room_type_id, d.stay_date::date::text AS stay_date, rd.price_paise, rt.base_price_paise
         FROM room_types rt
         CROSS JOIN generate_series($2::date, $3::date, interval '1 day') AS d(stay_date)
         LEFT JOIN room_day rd ON rd.room_type_id = rt.id AND rd.stay_date = d.stay_date::date
        WHERE rt.id = ANY($1)`,
      [roomTypeIds, from, to],
    );
    const priceByNight = new Map(priced.map((r) => [key(r.room_type_id, r.stay_date), r]));

    response.status(200).json({
      from,
      to,
      days: availability.map((a) => {
        const breakdown = splitByNight.get(key(a.roomTypeId, a.stayDate));
        const price = priceByNight.get(key(a.roomTypeId, a.stayDate));
        return {
          roomTypeId: a.roomTypeId,
          stayDate: a.stayDate,
          allotment: a.allotment,
          committed: a.committed,
          confirmed: breakdown?.confirmed ?? 0,
          held: breakdown?.held ?? 0,
          remaining: a.remaining,
          isBlackout: a.isBlackout,
          pricePaise: price?.price_paise ?? price?.base_price_paise ?? 0,
          hasOverride: price?.price_paise !== null && price?.price_paise !== undefined,
        };
      }),
    });
  } catch (error) {
    next(error);
  }
}
