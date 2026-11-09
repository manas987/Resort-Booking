import type { NextFunction, Request, Response } from 'express';
import { pool } from '../../../db.ts';
import { AppError, badRequest, notFound } from '../../../middleware/errors.ts';
import { listBookingsQuerySchema } from './schema.ts';

function encodeCursor(createdAt: string, id: string): string {
  return Buffer.from(JSON.stringify({ createdAt, id })).toString('base64');
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

type BookingRow = {
  id: string;
  reference: string;
  status: string;
  check_in: string;
  check_out: string;
  guest_name: string;
  guest_email: string;
  total_paise: number;
  created_at: string;
  cursor_value: string;
};

/** Sales sees every booking (§5) — no scope filter here, unlike `admin/enquiries` (INV-38 is
 *  an enquiry-ownership rule, not a booking one). */
export async function readBookingsController(request: Request, response: Response, next: NextFunction): Promise<void> {
  const parsed = listBookingsQuerySchema.safeParse(request.query);
  if (!parsed.success) return next(badRequest(parsed.error));
  const query = parsed.data;
  const cursor = query.cursor ? decodeCursor(query.cursor) : null;
  if (query.cursor && !cursor) return next(new AppError('validation_failed', 'Invalid cursor.'));

  const params: unknown[] = [];
  const conditions: string[] = ['TRUE'];
  if (query.status) {
    params.push(query.status);
    conditions.push(`status = $${params.length}`);
  }
  if (query.search) {
    params.push(`%${query.search}%`);
    conditions.push(`(reference ILIKE $${params.length} OR guest_email ILIKE $${params.length} OR guest_name ILIKE $${params.length})`);
  }
  if (cursor) {
    params.push(cursor.createdAt, cursor.id);
    conditions.push(`(created_at, id) < ($${params.length - 1}::timestamptz, $${params.length}::uuid)`);
  }
  params.push(query.limit);

  try {
    const { rows } = await pool.query<BookingRow>(
      `SELECT id, reference, status, check_in, check_out, guest_name, guest_email, total_paise,
              created_at, created_at::text AS cursor_value
         FROM bookings
        WHERE ${conditions.join(' AND ')}
        ORDER BY created_at DESC, id DESC
        LIMIT $${params.length}`,
      params,
    );
    const last = rows[rows.length - 1];
    const nextCursor = rows.length === query.limit && last ? encodeCursor(last.cursor_value, last.id) : null;
    response.status(200).json({
      items: rows.map((r) => ({
        bookingId: r.id,
        reference: r.reference,
        status: r.status,
        checkIn: r.check_in,
        checkOut: r.check_out,
        guestName: r.guest_name,
        guestEmail: r.guest_email,
        totalPaise: r.total_paise,
        createdAt: r.created_at,
      })),
      nextCursor,
    });
  } catch (error) {
    next(error);
  }
}

export async function readBookingController(request: Request, response: Response, next: NextFunction): Promise<void> {
  const { bookingId } = request.params as { bookingId: string };
  try {
    const { rows } = await pool.query<{
      id: string; reference: string; status: string; check_in: string; check_out: string;
      guest_name: string; guest_email: string; guest_phone: string;
      room_paise: number; discount_paise: number; tax_paise: number; total_paise: number;
      confirmed_at: string | null; created_at: string;
    }>(
      `SELECT id, reference, status, check_in, check_out, guest_name, guest_email, guest_phone,
              room_paise, discount_paise, tax_paise, total_paise, confirmed_at, created_at
         FROM bookings WHERE id = $1`,
      [bookingId],
    );
    const booking = rows[0];
    if (!booking) return next(notFound('Booking'));

    const { rows: rooms } = await pool.query<{ id: string; room_type_id: string; room_name_snapshot: string; adults: number; children: number }>(
      `SELECT id, room_type_id, room_name_snapshot, adults, children FROM booking_rooms WHERE booking_id = $1`,
      [bookingId],
    );
    const { rows: nights } = await pool.query<{ booking_room_id: string; stay_date: string; price_paise: number; discount_paise: number; tax_paise: number }>(
      `SELECT booking_room_id, stay_date, price_paise, discount_paise, tax_paise FROM booking_nights WHERE booking_id = $1 ORDER BY stay_date`,
      [bookingId],
    );
    const { rows: payments } = await pool.query<{ id: string; status: string; amount_paise: number; failure_reason: string | null; created_at: string }>(
      `SELECT id, status, amount_paise, failure_reason, created_at FROM payments WHERE booking_id = $1 ORDER BY attempt_no`,
      [bookingId],
    );
    const { rows: refunds } = await pool.query<{ id: string; reason: string; amount_paise: number; status: string; failure_reason: string | null }>(
      `SELECT id, reason, amount_paise, status, failure_reason FROM refunds WHERE booking_id = $1`,
      [bookingId],
    );

    response.status(200).json({
      bookingId: booking.id,
      reference: booking.reference,
      status: booking.status,
      checkIn: booking.check_in,
      checkOut: booking.check_out,
      guestName: booking.guest_name,
      guestEmail: booking.guest_email,
      guestPhone: booking.guest_phone,
      roomPaise: booking.room_paise,
      discountPaise: booking.discount_paise,
      taxPaise: booking.tax_paise,
      totalPaise: booking.total_paise,
      confirmedAt: booking.confirmed_at,
      createdAt: booking.created_at,
      rooms: rooms.map((r) => ({
        bookingRoomId: r.id,
        roomTypeId: r.room_type_id,
        roomName: r.room_name_snapshot,
        adults: r.adults,
        children: r.children,
        nights: nights
          .filter((n) => n.booking_room_id === r.id)
          .map((n) => ({ stayDate: n.stay_date, pricePaise: n.price_paise, discountPaise: n.discount_paise, taxPaise: n.tax_paise })),
      })),
      payments: payments.map((p) => ({ id: p.id, status: p.status, amountPaise: p.amount_paise, failureReason: p.failure_reason, createdAt: p.created_at })),
      refunds: refunds.map((r) => ({ id: r.id, reason: r.reason, amountPaise: r.amount_paise, status: r.status, failureReason: r.failure_reason })),
    });
  } catch (error) {
    next(error);
  }
}
