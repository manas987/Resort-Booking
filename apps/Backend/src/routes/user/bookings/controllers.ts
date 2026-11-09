import type { NextFunction, Request, Response } from 'express';
import { pool } from '../../../db.ts';
import { AppError, badRequest, notFound } from '../../../middleware/errors.ts';
import { createBookingHold } from '../../../core/booking.ts';
import type { Principal } from '../../../core/tokens.ts';
import { createBookingSchema, listBookingsQuerySchema } from './schema.ts';

function currentGuest(response: Response): Principal {
  return response.locals.principal as Principal;
}

/** `V, I` — requireVerifiedGuest + requireIdempotencyKey already ran. All amounts come from
 *  the quote, never the body (INV-7). */
export async function createBookingController(
  request: Request,
  response: Response,
  next: NextFunction,
): Promise<void> {
  const parsed = createBookingSchema.safeParse(request.body);
  if (!parsed.success) return next(badRequest(parsed.error));
  const guest = currentGuest(response);

  try {
    const hold = await createBookingHold({
      quoteId: parsed.data.quoteId,
      actorUserId: guest.userId,
      idempotencyKey: response.locals.idempotencyKey!,
      guestName: parsed.data.guestName,
      guestEmail: parsed.data.guestEmail,
      guestPhone: parsed.data.guestPhone,
    });
    response.status(201).json({
      bookingId: hold.bookingId,
      reference: hold.reference,
      holdExpiresAt: hold.holdExpiresAt,
    });
  } catch (error) {
    next(error);
  }
}

type BookingRow = {
  id: string;
  reference: string;
  status: string;
  check_in: string;
  check_out: string;
  hold_expires_at: string | null;
  total_paise: number;
  created_at: string;
};

function encodeCursor(row: { created_at: string; id: string }): string {
  return Buffer.from(JSON.stringify({ createdAt: row.created_at, id: row.id })).toString('base64');
}
function decodeCursor(cursor: string): { createdAt: string; id: string } | null {
  try {
    const parsed = JSON.parse(Buffer.from(cursor, 'base64').toString('utf8'));
    if (typeof parsed.createdAt === 'string' && typeof parsed.id === 'string') return parsed;
    return null;
  } catch {
    return null;
  }
}

function serializeBooking(row: BookingRow) {
  return {
    bookingId: row.id,
    reference: row.reference,
    status: row.status,
    checkIn: row.check_in,
    checkOut: row.check_out,
    holdExpiresAt: row.hold_expires_at,
    totalPaise: row.total_paise,
  };
}

export async function readBookingsController(
  request: Request,
  response: Response,
  next: NextFunction,
): Promise<void> {
  const parsed = listBookingsQuerySchema.safeParse(request.query);
  if (!parsed.success) return next(badRequest(parsed.error));
  const guest = currentGuest(response);
  const cursor = parsed.data.cursor ? decodeCursor(parsed.data.cursor) : null;
  if (parsed.data.cursor && !cursor) {
    next(new AppError('validation_failed', 'Invalid cursor.'));
    return;
  }

  try {
    const { rows } = await pool.query<BookingRow>(
      `SELECT id, reference, status, check_in, check_out, hold_expires_at, total_paise, created_at
         FROM bookings
        WHERE guest_user_id = $1
          AND ($2::timestamptz IS NULL OR (created_at, id) < ($2::timestamptz, $3::uuid))
        ORDER BY created_at DESC, id DESC
        LIMIT $4`,
      [guest.userId, cursor?.createdAt ?? null, cursor?.id ?? null, parsed.data.limit],
    );
    const nextCursor = rows.length === parsed.data.limit ? encodeCursor(rows[rows.length - 1]!) : null;
    response.status(200).json({ items: rows.map(serializeBooking), nextCursor });
  } catch (error) {
    next(error);
  }
}

export async function readBookingController(
  request: Request,
  response: Response,
  next: NextFunction,
): Promise<void> {
  const guest = currentGuest(response);
  try {
    const { rows } = await pool.query<BookingRow>(
      `SELECT id, reference, status, check_in, check_out, hold_expires_at, total_paise, created_at
         FROM bookings WHERE id = $1 AND guest_user_id = $2`,
      [request.params.bookingId, guest.userId],
    );
    const booking = rows[0];
    if (!booking) return next(notFound('Booking'));
    response.status(200).json(serializeBooking(booking));
  } catch (error) {
    next(error);
  }
}

/** The cheap poll for an uncertain write (ID-5, 1H) — recovers real state without creating
 *  anything. */
export async function readBookingStatusController(
  request: Request,
  response: Response,
  next: NextFunction,
): Promise<void> {
  const guest = currentGuest(response);
  try {
    const { rows } = await pool.query<{ reference: string; status: string; hold_expires_at: string | null }>(
      `SELECT reference, status, hold_expires_at FROM bookings
        WHERE reference = $1 AND guest_user_id = $2`,
      [request.params.reference, guest.userId],
    );
    const booking = rows[0];
    if (!booking) return next(notFound('Booking'));
    response.status(200).json({
      reference: booking.reference,
      status: booking.status,
      holdExpiresAt: booking.hold_expires_at,
    });
  } catch (error) {
    next(error);
  }
}
