import type { NextFunction, Request, Response } from 'express';
import { withTransaction } from '../../../db.ts';
import type { Tx } from '../../../db.ts';
import { AppError, badRequest, notFound } from '../../../middleware/errors.ts';
import type { Principal } from '../../../core/tokens.ts';
import { enqueueJob } from '../../../core/jobs.ts';
import { recordAuditEvent } from '../../../core/audit.ts';
import { sendReplySchema, createNoteSchema } from './schema.ts';

function actor(response: Response): Principal {
  return response.locals.principal as Principal;
}

/** `assignedOrAbove`, expressed as a row-scoped lookup rather than middleware
 * (02-permissions.md) — same ownership-beats-existence pattern as `admin/enquiries`. Kept as
 * its own small copy per feature folder rather than imported, per 07-backend-structure.md's
 * "no shared HTTP code" convention within a tree. */
async function loadAssignedOrAbove(client: Tx, principal: Principal, enquiryId: string): Promise<{ id: string; source: string; status: string } | null> {
  const scoped = principal.role === 'gm' || principal.role === 'owner';
  const params = scoped ? [enquiryId] : [enquiryId, principal.userId];
  const { rows } = await client.query<{ id: string; source: string; status: string }>(
    `SELECT id, source, status FROM enquiries WHERE id = $1 AND (${scoped ? 'TRUE' : 'assignee_id = $2'}) FOR UPDATE`,
    params,
  );
  return rows[0] ?? null;
}

/** Sending is the explicit human act that turns a draft into a message (INV-46) — there is
 *  no auto-send path anywhere. Delivery is queued, not synchronous, so `first_staff_reply_at`
 *  is stamped later, only on confirmed delivery (`jobs/handlers/sendMessage`), never here. */
export async function sendEnquiryReplyController(request: Request, response: Response, next: NextFunction): Promise<void> {
  const parsed = sendReplySchema.safeParse(request.body);
  if (!parsed.success) return next(badRequest(parsed.error));
  const principal = actor(response);
  const { enquiryId } = request.params as { enquiryId: string };

  try {
    const result = await withTransaction(async (client) => {
      const enquiry = await loadAssignedOrAbove(client, principal, enquiryId);
      if (!enquiry) throw notFound('Enquiry');

      let fromAiRunId: string | null = null;
      if (parsed.data.draftId) {
        const { rows: draftRows } = await client.query<{ id: string; ai_run_id: string }>(
          `SELECT id, ai_run_id FROM ai_drafts WHERE id = $1 AND enquiry_id = $2 AND state = 'pending' FOR UPDATE`,
          [parsed.data.draftId, enquiry.id],
        );
        if (!draftRows[0]) throw new AppError('validation_failed', 'That draft is no longer pending.');
        fromAiRunId = draftRows[0].ai_run_id;
        await client.query(`UPDATE ai_drafts SET state = 'sent', updated_at = now() WHERE id = $1`, [parsed.data.draftId]);
      }

      const { rows: messageRows } = await client.query<{ id: string }>(
        `INSERT INTO enquiry_messages (enquiry_id, direction, visibility, author_user_id, body, from_ai_run_id, delivery_status)
         VALUES ($1, 'outbound', 'guest', $2, $3, $4, 'pending')
         RETURNING id`,
        [enquiry.id, principal.userId, parsed.data.body, fromAiRunId],
      );
      const messageId = messageRows[0]!.id;

      // Accepting a human reply starts handling; delivery metrics still wait for the worker.
      await client.query(
        `UPDATE enquiries SET status = 'in_progress', resolved_at = NULL, last_activity_at = now(),
                reopened_count = reopened_count + CASE WHEN status = 'resolved' THEN 1 ELSE 0 END
          WHERE id = $1`,
        [enquiry.id],
      );
      if (enquiry.status !== 'in_progress') {
        await client.query(
          `INSERT INTO enquiry_events (enquiry_id, actor_id, actor_kind, type, before, after)
           VALUES ($1, $2, 'employee', $3, $4, $5)`,
          [enquiry.id, principal.userId, enquiry.status === 'resolved' ? 'reopened' : 'status_changed',
            JSON.stringify({ status: enquiry.status }), JSON.stringify({ status: 'in_progress' })],
        );
      }

      await client.query(
        `INSERT INTO enquiry_events (enquiry_id, actor_id, actor_kind, type) VALUES ($1, $2, 'employee', 'reply_sent')`,
        [enquiry.id, principal.userId],
      );
      // Staff-approved replies are audited (00-conventions.md's audit list, AU-4) — a draft
      // never sent is not, since nothing was approved.
      await recordAuditEvent(client, {
        actorUserId: principal.userId, actorRole: principal.role, action: 'enquiry.reply_sent', targetKind: 'enquiry_message', targetId: messageId,
        after: { enquiryId: enquiry.id, fromDraft: fromAiRunId !== null },
      });
      // Queued, delivered on the thread's own channel — a reply on an email/WhatsApp thread
      // stays on that channel, it never becomes a website notification.
      await enqueueJob(client, {
        type: 'send_message',
        payload: { kind: 'enquiry_reply', messageId, enquiryId: enquiry.id, channel: enquiry.source },
        dedupeKey: `enquiry_reply:${messageId}`,
      });
      return { messageId };
    });
    response.status(201).json({ messageId: result.messageId });
  } catch (error) {
    next(error);
  }
}

export async function createInternalNoteController(request: Request, response: Response, next: NextFunction): Promise<void> {
  const parsed = createNoteSchema.safeParse(request.body);
  if (!parsed.success) return next(badRequest(parsed.error));
  const principal = actor(response);
  const { enquiryId } = request.params as { enquiryId: string };

  try {
    const result = await withTransaction(async (client) => {
      const enquiry = await loadAssignedOrAbove(client, principal, enquiryId);
      if (!enquiry) throw notFound('Enquiry');

      const { rows } = await client.query<{ id: string }>(
        `INSERT INTO enquiry_messages (enquiry_id, direction, visibility, author_user_id, body)
         VALUES ($1, 'outbound', 'internal', $2, $3)
         RETURNING id`,
        [enquiry.id, principal.userId, parsed.data.body],
      );
      await client.query(`UPDATE enquiries SET last_activity_at = now() WHERE id = $1`, [enquiry.id]);
      return { id: rows[0]!.id };
    });
    response.status(201).json({ messageId: result.id });
  } catch (error) {
    next(error);
  }
}
