import type { NextFunction, Request, Response } from 'express';
import { pool } from '../../../db.ts';
import { badRequest } from '../../../middleware/errors.ts';
import { readAvailability } from '../../../core/inventory.ts';
import { calendarQuerySchema } from './schema.ts';

export async function readBookingCalendarController(request: Request, response: Response, next: NextFunction): Promise<void> {
  const parsed = calendarQuerySchema.safeParse(request.query);
  if (!parsed.success) return next(badRequest(parsed.error));
  const { from, to, roomTypeId } = parsed.data;

  try {
    const roomTypeIds = roomTypeId
      ? [roomTypeId]
      : (await pool.query<{ id: string }>(`SELECT id FROM room_types ORDER BY sort_order, name`)).rows.map((r) => r.id);

    const availability = await readAvailability(pool, { stay: { checkIn: from, checkOut: to }, roomTypeIds });
    response.status(200).json({
      from,
      to,
      days: availability.map((a) => ({
        roomTypeId: a.roomTypeId,
        stayDate: a.stayDate,
        allotment: a.allotment,
        committed: a.committed,
        remaining: a.remaining,
        isBlackout: a.isBlackout,
      })),
    });
  } catch (error) {
    next(error);
  }
}
