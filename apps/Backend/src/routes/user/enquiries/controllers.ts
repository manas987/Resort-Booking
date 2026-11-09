import type { NextFunction, Request, Response } from 'express';
import { pool, withTransaction, withSavepoint, PG, isPgError } from '../../../db.ts';
import type { Tx } from '../../../db.ts';
import { AppError, badRequest, notFound } from '../../../middleware/errors.ts';
import type { Principal } from '../../../core/tokens.ts';
import { enqueueJob } from '../../../core/jobs.ts';
import { generateEnquiryRef } from '../../../core/enquiry/assignment.ts';
import { createEnquirySchema, listEnquiriesQuerySchema, createBookingEnquirySchema } from './schema.ts';

function currentGuest(response: Response): Principal {
  return response.locals.principal as Principal;
}

type ContactRow = { name: string; email: string | null; phone: string | null };

async function insertEnquiry(
  client: Tx,
  input: { guestUserId: string; contact: ContactRow; message: string; bookingId?: string },
): Promise<{ id: string; publicRef: string }> {
  let enquiryId: string | undefined;
  let publicRef: string | undefined;
  for (let attempt = 0; attempt < 5 && !enquiryId; attempt += 1) {
    const candidate = generateEnquiryRef();
    try {
      // A unique violation must not abort the surrounding transaction (db.ts withSavepoint),
      // or the retry on the next candidate ref cannot succeed.
      const { rows } = await withSavepoint(client, () => client.query<{ id: string }>(
        `INSERT INTO enquiries
           (public_ref, source, status, guest_user_id, booking_id, contact_name, contact_email, contact_phone)
         VALUES ($1, 'website', 'new', $2, $3, $4, $5, $6)
         RETURNING id`,
        [candidate, input.guestUserId, input.bookingId ?? null, input.contact.name, input.contact.email, input.contact.phone],
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
    [enquiryId, input.guestUserId, input.message],
  );
  await client.query(
    `INSERT INTO enquiry_events (enquiry_id, actor_id, actor_kind, type)
     VALUES ($1, $2, 'guest', 'created')`,
    [enquiryId, input.guestUserId],
  );
  return { id: enquiryId, publicRef };
}

async function contactFor(client: Tx, guestUserId: string): Promise<ContactRow> {
  const { rows } = await client.query<ContactRow>(`SELECT name, email, phone FROM users WHERE id = $1`, [guestUserId]);
  return rows[0]!;
}

/** Persisted BEFORE any AI work, then enqueues `classify_enquiry` inside the same
 *  transaction (INV-40) — a provider outage never loses the enquiry (EL-2). */
export async function createEnquiryController(
  request: Request,
  response: Response,
  next: NextFunction,
): Promise<void> {
  const parsed = createEnquirySchema.safeParse(request.body);
  if (!parsed.success) return next(badRequest(parsed.error));
  const guest = currentGuest(response);

  try {
    const result = await withTransaction(async (client) => {
      const contact = await contactFor(client, guest.userId);
      const enquiry = await insertEnquiry(client, { guestUserId: guest.userId, contact, message: parsed.data.message });
      await enqueueJob(client, { type: 'classify_enquiry', payload: { enquiryId: enquiry.id } });
      return enquiry;
    });
    response.status(201).json({ enquiryId: result.id, publicRef: result.publicRef });
  } catch (error) {
    next(error);
  }
}

/** The backend verifies ownership and sets `booking_id` itself — a client never gets to
 *  link an arbitrary booking by typing its reference (INV-22). */
export async function createBookingEnquiryController(
  request: Request,
  response: Response,
  next: NextFunction,
): Promise<void> {
  const parsed = createBookingEnquirySchema.safeParse(request.body);
  if (!parsed.success) return next(badRequest(parsed.error));
  const guest = currentGuest(response);

  try {
    const { rows } = await pool.query<{ id: string }>(
      `SELECT id FROM bookings WHERE id = $1 AND guest_user_id = $2`,
      [request.params.bookingId, guest.userId],
    );
    if (!rows[0]) return next(notFound('Booking'));

    const result = await withTransaction(async (client) => {
      const contact = await contactFor(client, guest.userId);
      const enquiry = await insertEnquiry(client, {
        guestUserId: guest.userId,
        contact,
        message: parsed.data.message,
        bookingId: rows[0]!.id,
      });
      await enqueueJob(client, { type: 'classify_enquiry', payload: { enquiryId: enquiry.id } });
      return enquiry;
    });
    response.status(201).json({ enquiryId: result.id, publicRef: result.publicRef });
  } catch (error) {
    next(error);
  }
}

type EnquiryRow = {
  id: string;
  public_ref: string;
  status: string;
  category: string | null;
  booking_id: string | null;
  last_activity_at: string;
  created_at: string;
};

function encodeCursor(row: { last_activity_at: string; id: string }): string {
  return Buffer.from(JSON.stringify({ lastActivityAt: row.last_activity_at, id: row.id })).toString('base64');
}
function decodeCursor(cursor: string): { lastActivityAt: string; id: string } | null {
  try {
    const parsed = JSON.parse(Buffer.from(cursor, 'base64').toString('utf8'));
    if (typeof parsed.lastActivityAt === 'string' && typeof parsed.id === 'string') return parsed;
    return null;
  } catch {
    return null;
  }
}

export async function readEnquiriesController(
  request: Request,
  response: Response,
  next: NextFunction,
): Promise<void> {
  const parsed = listEnquiriesQuerySchema.safeParse(request.query);
  if (!parsed.success) return next(badRequest(parsed.error));
  const guest = currentGuest(response);
  const cursor = parsed.data.cursor ? decodeCursor(parsed.data.cursor) : null;
  if (parsed.data.cursor && !cursor) {
    next(new AppError('validation_failed', 'Invalid cursor.'));
    return;
  }

  try {
    const { rows } = await pool.query<EnquiryRow>(
      `SELECT id, public_ref, status, category, booking_id, last_activity_at, created_at
         FROM enquiries
        WHERE guest_user_id = $1
          AND ($2::timestamptz IS NULL OR (last_activity_at, id) < ($2::timestamptz, $3::uuid))
        ORDER BY last_activity_at DESC, id DESC
        LIMIT $4`,
      [guest.userId, cursor?.lastActivityAt ?? null, cursor?.id ?? null, parsed.data.limit],
    );
    const nextCursor = rows.length === parsed.data.limit ? encodeCursor(rows[rows.length - 1]!) : null;
    response.status(200).json({
      items: rows.map((r) => ({
        enquiryId: r.id,
        publicRef: r.public_ref,
        status: r.status,
        category: r.category,
        bookingId: r.booking_id,
        lastActivityAt: r.last_activity_at,
      })),
      nextCursor,
    });
  } catch (error) {
    next(error);
  }
}

/** Guest-visible messages only — no internal notes, no AI internals, no assignee details
 *  (INV-41). */
export async function readEnquiryController(
  request: Request,
  response: Response,
  next: NextFunction,
): Promise<void> {
  const guest = currentGuest(response);
  try {
    const { rows } = await pool.query<EnquiryRow>(
      `SELECT id, public_ref, status, category, booking_id, last_activity_at, created_at
         FROM enquiries WHERE id = $1 AND guest_user_id = $2`,
      [request.params.enquiryId, guest.userId],
    );
    const enquiry = rows[0];
    if (!enquiry) return next(notFound('Enquiry'));

    const { rows: messages } = await pool.query<{
      id: string;
      direction: string;
      body: string;
      created_at: string;
    }>(
      `SELECT id, direction, body, created_at FROM enquiry_messages
         WHERE enquiry_id = $1 AND visibility = 'guest' ORDER BY created_at`,
      [enquiry.id],
    );

    response.status(200).json({
      enquiryId: enquiry.id,
      publicRef: enquiry.public_ref,
      status: enquiry.status,
      category: enquiry.category,
      bookingId: enquiry.booking_id,
      messages: messages.map((m) => ({ id: m.id, direction: m.direction, body: m.body, createdAt: m.created_at })),
    });
  } catch (error) {
    next(error);
  }
}
