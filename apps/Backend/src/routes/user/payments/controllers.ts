import type { NextFunction, Request, Response } from 'express';
import { withTransaction, PG, isPgError } from '../../../db.ts';
import { pool } from '../../../db.ts';
import { AppError, badRequest, notFound } from '../../../middleware/errors.ts';
import type { Principal } from '../../../core/tokens.ts';
import { beginPaymentAttempt } from '../../../adapters/mockPayments.ts';
import { createPaymentAttemptSchema } from './schema.ts';

/** `V, I, own`. The outcome field is honoured only under DEMO_MODE (INV-25) — the browser
 *  never decides a booking is paid; `beginPaymentAttempt` enforces that, not this controller. */
export async function createPaymentAttemptController(
  request: Request,
  response: Response,
  next: NextFunction,
): Promise<void> {
  const parsed = createPaymentAttemptSchema.safeParse(request.body);
  if (!parsed.success) return next(badRequest(parsed.error));
  const guest = response.locals.principal as Principal;

  try {
    const { rows } = await pool.query<{ id: string; status: string; total_paise: number }>(
      `SELECT id, status, total_paise FROM bookings WHERE id = $1 AND guest_user_id = $2`,
      [request.params.bookingId, guest.userId],
    );
    const booking = rows[0];
    if (!booking) return next(notFound('Booking'));
    if (booking.status !== 'pending_payment') {
      next(new AppError('validation_failed', 'This booking is not awaiting payment.'));
      return;
    }

    const result = await withTransaction((client) =>
      beginPaymentAttempt(client, {
        bookingId: booking.id,
        amountPaise: booking.total_paise,
        outcome: parsed.data.outcome,
      }),
    );
    response.status(201).json(result);
  } catch (error) {
    if (isPgError(error, PG.UNIQUE_VIOLATION)) {
      next(new AppError('validation_failed', 'A payment attempt is already in progress for this booking.'));
      return;
    }
    next(error);
  }
}
