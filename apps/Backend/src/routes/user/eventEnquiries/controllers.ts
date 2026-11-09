import type { NextFunction, Request, Response } from 'express';
import { withTransaction, withSavepoint, PG, isPgError } from '../../../db.ts';
import { AppError, badRequest } from '../../../middleware/errors.ts';
import type { Principal } from '../../../core/tokens.ts';
import { generateEnquiryRef, routeEnquiry, assignEnquiry } from '../../../core/enquiry/assignment.ts';
import { createEventEnquirySchema } from './schema.ts';

function summarize(input: ReturnType<typeof createEventEnquirySchema.parse>): string {
  const dates =
    input.preferredDates.type === 'exact'
      ? `${input.preferredDates.checkIn} to ${input.preferredDates.checkOut}`
      : input.preferredDates.type === 'month'
        ? input.preferredDates.month
        : input.preferredDates.notes;
  return [
    `${input.eventType === 'wedding' ? 'Wedding' : 'Corporate offsite'} enquiry.`,
    `Preferred dates: ${dates}.`,
    `${input.guestCount} guests, ${input.roomsNeeded} rooms, ${input.nights} nights.`,
    input.budgetPaise !== undefined ? `Budget: ${input.budgetPaise} paise.` : null,
    input.requirements ? `Requirements: ${input.requirements}` : null,
  ]
    .filter(Boolean)
    .join(' ');
}

/** §8G: this creates an enquiry only. No lawn reserved, no deposit, no package price taken
 *  (the event form is never a transaction). The category is guest-declared, not AI-guessed —
 *  no `classify_enquiry` job, same reasoning as a website enquiry's `routeEnquiry` call but
 *  skipping the classification step entirely. */
export async function createEventEnquiryController(
  request: Request,
  response: Response,
  next: NextFunction,
): Promise<void> {
  const parsed = createEventEnquirySchema.safeParse(request.body);
  if (!parsed.success) return next(badRequest(parsed.error));
  const guest = response.locals.principal as Principal;

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
               (public_ref, source, status, category, guest_user_id, contact_name, contact_email,
                contact_phone, extracted, ai_status)
             VALUES ($1, 'website', 'new', $2, $3, $4, $5, $6, $7, 'skipped')
             RETURNING id`,
            [
              candidate,
              parsed.data.eventType,
              guest.userId,
              parsed.data.contactName,
              parsed.data.contactEmail ?? null,
              parsed.data.contactPhone ?? null,
              JSON.stringify(parsed.data),
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
        `INSERT INTO enquiry_messages (enquiry_id, direction, visibility, author_user_id, body)
         VALUES ($1, 'inbound', 'guest', $2, $3)`,
        [enquiryId, guest.userId, summarize(parsed.data)],
      );
      await client.query(
        `INSERT INTO enquiry_events (enquiry_id, actor_id, actor_kind, type) VALUES ($1, $2, 'guest', 'created')`,
        [enquiryId, guest.userId],
      );

      const routing = await routeEnquiry(client, { category: parsed.data.eventType, needsReview: false });
      if (routing.assigneeId) {
        await assignEnquiry(client, { enquiryId, assigneeId: routing.assigneeId, actorUserId: guest.userId, reason: 'auto' });
      }

      return { id: enquiryId, publicRef };
    });
    response.status(201).json({ enquiryId: result.id, publicRef: result.publicRef });
  } catch (error) {
    next(error);
  }
}
