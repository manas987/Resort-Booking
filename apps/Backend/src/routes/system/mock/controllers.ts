import type { NextFunction, Request, Response } from 'express';
import { withTransaction, withSavepoint, PG, isPgError } from '../../../db.ts';
import { AppError, badRequest } from '../../../middleware/errors.ts';
import { generateEnquiryRef } from '../../../core/enquiry/assignment.ts';
import { enqueueJob } from '../../../core/jobs.ts';
import { injectInboundSchema } from './schema.ts';

const CHANNELS = new Set(['email', 'whatsapp']);

/** A safe way for reviewers to exercise simulated incoming messages (Product.md §25). Never
 *  sets `guest_user_id` — a WhatsApp/email thread is never a website guest's own account,
 *  by the same `enquiry_guest_only_website` CHECK that refuses it at the database (INV-42). */
export async function injectInboundController(
  request: Request,
  response: Response,
  next: NextFunction,
): Promise<void> {
  const channel = String(request.params.channel ?? '');
  if (!CHANNELS.has(channel)) {
    next(new AppError('validation_failed', 'Unknown channel.'));
    return;
  }
  const parsed = injectInboundSchema.safeParse(request.body);
  if (!parsed.success) return next(badRequest(parsed.error));

  try {
    const result = await withTransaction(async (client) => {
      let enquiryId: string | undefined;
      let publicRef: string | undefined;
      for (let attempt = 0; attempt < 5 && !enquiryId; attempt += 1) {
        const candidate = generateEnquiryRef();
        try {
          // A unique violation must not abort the surrounding transaction (db.ts withSavepoint),
          // or the retry on the next candidate ref cannot succeed.
          const { rows } = await withSavepoint(client, () => client.query<{ id: string }>(
            `INSERT INTO enquiries
               (public_ref, source, source_identifier, status, contact_name,
                contact_email, contact_phone)
             VALUES ($1, $2, $3, 'new', $4, $5, $6)
             RETURNING id`,
            [
              candidate,
              channel,
              parsed.data.from,
              parsed.data.contactName ?? null,
              channel === 'email' ? parsed.data.from : null,
              channel === 'whatsapp' ? parsed.data.from : null,
            ],
          ));
          enquiryId = rows[0]!.id;
          publicRef = candidate;
        } catch (error) {
          if (!isPgError(error, PG.UNIQUE_VIOLATION)) throw error;
        }
      }
      if (!enquiryId || !publicRef) {
        throw new AppError('internal_error', 'Could not generate a unique enquiry reference.');
      }

      await client.query(
        `INSERT INTO enquiry_messages (enquiry_id, direction, visibility, body)
         VALUES ($1, 'inbound', 'guest', $2)`,
        [enquiryId, parsed.data.message],
      );
      await client.query(
        `INSERT INTO enquiry_events (enquiry_id, actor_kind, type) VALUES ($1, 'system', 'created')`,
        [enquiryId],
      );
      await enqueueJob(client, { type: 'classify_enquiry', payload: { enquiryId } });

      return { id: enquiryId, publicRef };
    });
    response.status(201).json({ enquiryId: result.id, publicRef: result.publicRef });
  } catch (error) {
    next(error);
  }
}
