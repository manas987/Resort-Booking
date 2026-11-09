import type { NextFunction, Request, Response } from 'express';
import { pool } from '../../../db.ts';
import { notFound } from '../../../middleware/errors.ts';
import type { Principal } from '../../../core/tokens.ts';

export async function readNotificationsController(_request: Request, response: Response, next: NextFunction): Promise<void> {
  const principal = response.locals.principal as Principal;
  try {
    const { rows } = await pool.query<{
      id: string;
      type: string;
      enquiry_id: string | null;
      booking_id: string | null;
      body: string;
      read_at: string | null;
      created_at: string;
    }>(
      `SELECT id, type, enquiry_id, booking_id, body, read_at, created_at
         FROM notifications WHERE user_id = $1 ORDER BY created_at DESC`,
      [principal.userId],
    );
    response.status(200).json({
      items: rows.map((r) => ({
        id: r.id,
        type: r.type,
        enquiryId: r.enquiry_id,
        bookingId: r.booking_id,
        body: r.body,
        readAt: r.read_at,
        createdAt: r.created_at,
      })),
    });
  } catch (error) {
    next(error);
  }
}

export async function markNotificationReadController(request: Request, response: Response, next: NextFunction): Promise<void> {
  const principal = response.locals.principal as Principal;
  const { notificationId } = request.params as { notificationId: string };
  try {
    const { rows } = await pool.query<{ id: string }>(
      `SELECT id FROM notifications WHERE id = $1 AND user_id = $2`,
      [notificationId, principal.userId],
    );
    if (!rows[0]) return next(notFound('Notification'));
    await pool.query(`UPDATE notifications SET read_at = COALESCE(read_at, now()) WHERE id = $1`, [notificationId]);
    response.status(200).json({ id: notificationId });
  } catch (error) {
    next(error);
  }
}
