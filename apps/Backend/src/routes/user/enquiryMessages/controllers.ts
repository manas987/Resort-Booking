import type { NextFunction, Request, Response } from 'express';
import { pool, withTransaction } from '../../../db.ts';
import { badRequest, notFound } from '../../../middleware/errors.ts';
import type { Principal } from '../../../core/tokens.ts';
import { applyGuestReply } from '../../../core/enquiry/assignment.ts';
import { sendEnquiryMessageSchema } from './schema.ts';

/** `A, own` — `applyGuestReply` owns the awaiting_guest/resolved -> in_progress transition
 *  and the reopened_count/assignee bookkeeping (INV-19). */
export async function sendEnquiryMessageController(
  request: Request,
  response: Response,
  next: NextFunction,
): Promise<void> {
  const parsed = sendEnquiryMessageSchema.safeParse(request.body);
  if (!parsed.success) return next(badRequest(parsed.error));
  const guest = response.locals.principal as Principal;

  try {
    const { rows } = await pool.query<{ id: string }>(
      `SELECT id FROM enquiries WHERE id = $1 AND guest_user_id = $2`,
      [request.params.enquiryId, guest.userId],
    );
    const enquiry = rows[0];
    if (!enquiry) return next(notFound('Enquiry'));

    await withTransaction(async (client) => {
      await client.query(
        `INSERT INTO enquiry_messages (enquiry_id, direction, visibility, author_user_id, body)
         VALUES ($1, 'inbound', 'guest', $2, $3)`,
        [enquiry.id, guest.userId, parsed.data.message],
      );
      await applyGuestReply(client, enquiry.id);
    });
    response.status(201).json({ enquiryId: enquiry.id });
  } catch (error) {
    next(error);
  }
}
