import type { NextFunction, Request, Response } from 'express';
import { pool } from '../../../db.ts';
import { AppError, badRequest, notFound } from '../../../middleware/errors.ts';
import { POLICY } from '../../../core/policy.ts';
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
  guest_phone: string;
  total_paise: number;
  hold_expires_at: string | null;
  confirmed_at: string | null;
  created_at: string;
  cursor_value: string;
  payment_status: string | null;
  refund_status: string | null;
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
    conditions.push(`b.status = $${params.length}`);
  }
  if (query.search) {
    params.push(`%${query.search}%`);
    conditions.push(`(b.reference ILIKE $${params.length} OR b.guest_email ILIKE $${params.length} OR b.guest_name ILIKE $${params.length})`);
  }
  // Confirmation-date window, in POLICY.timezone — identical to the CSV export's clause (§21),
  // so a figure read on a report and a file exported for the same range cannot disagree.
  if (query.confirmedFrom || query.confirmedTo) {
    params.push(POLICY.timezone);
    const tz = params.length;
    conditions.push('b.confirmed_at IS NOT NULL');
    if (query.confirmedFrom) {
      params.push(query.confirmedFrom);
      conditions.push(`(b.confirmed_at AT TIME ZONE $${tz})::date >= $${params.length}::date`);
    }
    if (query.confirmedTo) {
      params.push(query.confirmedTo);
      conditions.push(`(b.confirmed_at AT TIME ZONE $${tz})::date <= $${params.length}::date`);
    }
  }
  if (cursor) {
    params.push(cursor.createdAt, cursor.id);
    conditions.push(`(b.created_at, b.id) < ($${params.length - 1}::timestamptz, $${params.length}::uuid)`);
  }
  params.push(query.limit);

  try {
    const { rows } = await pool.query<BookingRow>(
      // `payment_status` is the LATEST attempt's status, by attempt_no — a booking may have
      // several (a decline then a success), and the screen shows one badge. The lateral join
      // keeps it to a single round trip rather than a query per row.
      `SELECT b.id, b.reference, b.status, b.check_in, b.check_out, b.guest_name, b.guest_email,
              b.guest_phone, b.total_paise, b.hold_expires_at, b.confirmed_at, b.created_at,
              b.created_at::text AS cursor_value, p.status AS payment_status, r.status AS refund_status
         FROM bookings b
         LEFT JOIN LATERAL (
           SELECT status FROM payments WHERE booking_id = b.id ORDER BY attempt_no DESC LIMIT 1
         ) p ON TRUE
         LEFT JOIN LATERAL (
           SELECT status FROM refunds WHERE booking_id = b.id ORDER BY created_at DESC LIMIT 1
         ) r ON TRUE
        WHERE ${conditions.join(' AND ')}
        ORDER BY b.created_at DESC, b.id DESC
        LIMIT $${params.length}`,
      params,
    );
    // One query for every row's booked rooms, grouped by type — the list shows "2 × Garden
    // Suite", and a query per booking would be an N+1 over the page.
    const { rows: roomRows } = await pool.query<{ booking_id: string; room_type_id: string; room_name_snapshot: string; quantity: number }>(
      `SELECT booking_id, room_type_id, room_name_snapshot, count(*)::int AS quantity
         FROM booking_rooms WHERE booking_id = ANY($1::uuid[])
        GROUP BY booking_id, room_type_id, room_name_snapshot
        ORDER BY room_name_snapshot`,
      [rows.map((r) => r.id)],
    );
    const roomsByBooking = new Map<string, Array<{ roomTypeId: string; roomName: string; quantity: number }>>();
    for (const room of roomRows) {
      const list = roomsByBooking.get(room.booking_id) ?? [];
      list.push({ roomTypeId: room.room_type_id, roomName: room.room_name_snapshot, quantity: room.quantity });
      roomsByBooking.set(room.booking_id, list);
    }

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
        guestPhone: r.guest_phone,
        totalPaise: r.total_paise,
        holdExpiresAt: r.hold_expires_at,
        confirmedAt: r.confirmed_at,
        createdAt: r.created_at,
        paymentStatus: r.payment_status,
        refundStatus: r.refund_status,
        rooms: roomsByBooking.get(r.id) ?? [],
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
      hold_expires_at: string | null; confirmed_at: string | null; created_at: string;
    }>(
      `SELECT id, reference, status, check_in, check_out, guest_name, guest_email, guest_phone,
              room_paise, discount_paise, tax_paise, total_paise, hold_expires_at, confirmed_at, created_at
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
      holdExpiresAt: booking.hold_expires_at,
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
