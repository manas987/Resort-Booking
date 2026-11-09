import type { NextFunction, Request, Response } from 'express';
import { pool, withTransaction } from '../../../db.ts';
import { AppError, badRequest, notFound } from '../../../middleware/errors.ts';
import type { Principal } from '../../../core/tokens.ts';
import { routeEnquiry, assignEnquiry, notifyComplaintAlert } from '../../../core/enquiry/assignment.ts';
import { recordAuditEvent } from '../../../core/audit.ts';
import { listEnquiriesQuerySchema, enquiryDetailQuerySchema, updateCategorySchema, updateStatusSchema } from './schema.ts';

function actor(response: Response): Principal {
  return response.locals.principal as Principal;
}

/** Staff see only their assigned threads; gm/owner see everything (INV-38). Expressed once
 *  so the list, the counts and the detail route cannot drift apart (IB-3's "counts equal
 *  their filtered lists" only holds if all three use the same scope). */
function scopeClause(principal: Principal, paramIndex: number): { sql: string; param: string | null } {
  if (principal.role === 'gm' || principal.role === 'owner') return { sql: 'TRUE', param: null };
  return { sql: `assignee_id = $${paramIndex}`, param: principal.userId };
}

function encodeCursor(value: string, id: string): string {
  return Buffer.from(JSON.stringify({ value, id })).toString('base64');
}
function decodeCursor(cursor: string): { value: string; id: string } | null {
  try {
    const parsed = JSON.parse(Buffer.from(cursor, 'base64').toString('utf8'));
    if (typeof parsed.value === 'string' && typeof parsed.id === 'string') return parsed;
    return null;
  } catch {
    return null;
  }
}

type EnquiryRow = {
  id: string;
  public_ref: string;
  source: string;
  status: string;
  category: string | null;
  assignee_id: string | null;
  contact_name: string | null;
  is_complaint: boolean;
  needs_review: boolean;
  last_activity_at: string;
  created_at: string;
};

export async function readEnquiriesController(request: Request, response: Response, next: NextFunction): Promise<void> {
  const parsed = listEnquiriesQuerySchema.safeParse(request.query);
  if (!parsed.success) return next(badRequest(parsed.error));
  const principal = actor(response);
  const query = parsed.data;
  const cursor = query.cursor ? decodeCursor(query.cursor) : null;
  if (query.cursor && !cursor) return next(new AppError('validation_failed', 'Invalid cursor.'));

  const column = query.sort; // validated enum, safe to interpolate — never request-derived text
  const params: unknown[] = [];
  const conditions: string[] = [];

  const scope = scopeClause(principal, 1);
  conditions.push(scope.sql);
  if (scope.param) params.push(scope.param);

  if (query.status) {
    params.push(query.status);
    conditions.push(query.status === 'in_progress'
      ? `status IN ($${params.length}, 'awaiting_guest')`
      : `status = $${params.length}`);
  }
  if (query.category) {
    params.push(query.category);
    conditions.push(`category = $${params.length}`);
  }
  if (query.source) {
    params.push(query.source);
    conditions.push(`source = $${params.length}`);
  }
  if (query.assignee) {
    params.push(query.assignee);
    conditions.push(`assignee_id = $${params.length}`);
  }
  if (query.complaint !== undefined) {
    params.push(query.complaint);
    conditions.push(`is_complaint = $${params.length}`);
  }
  if (query.needsReview !== undefined) {
    params.push(query.needsReview);
    conditions.push(`needs_review = $${params.length}`);
  }
  if (query.unassigned !== undefined) {
    // A resolved thread needs no assignment action, so it's never part of the Unassigned
    // lane (same definition as the counts facet below — IB-3 requires they agree).
    conditions.push(query.unassigned ? `assignee_id IS NULL AND status <> 'resolved'` : `assignee_id IS NOT NULL`);
  }
  if (query.search) {
    params.push(`%${query.search}%`);
    conditions.push(`(public_ref ILIKE $${params.length} OR contact_name ILIKE $${params.length} OR contact_email ILIKE $${params.length})`);
  }
  if (cursor) {
    params.push(cursor.value, cursor.id);
    conditions.push(`(${column}, id) < ($${params.length - 1}::timestamptz, $${params.length}::uuid)`);
  }

  params.push(query.limit);

  try {
    // `${column}::text` carries full microsecond precision for the cursor — the pg driver
    // parses timestamptz into a JS Date, and a Date round-tripped through JSON truncates to
    // milliseconds, which silently drops or re-includes rows that tie at the page boundary.
    const { rows } = await pool.query<EnquiryRow & { cursor_value: string }>(
      `SELECT id, public_ref, source, status, category, assignee_id, contact_name, is_complaint, needs_review,
              last_activity_at, created_at, ${column}::text AS cursor_value
         FROM enquiries
        WHERE ${conditions.join(' AND ')}
        ORDER BY ${column} DESC, id DESC
        LIMIT $${params.length}`,
      params,
    );
    const last = rows[rows.length - 1];
    const nextCursor = rows.length === query.limit && last ? encodeCursor(last.cursor_value, last.id) : null;
    response.status(200).json({
      items: rows.map((r) => ({
        enquiryId: r.id,
        publicRef: r.public_ref,
        source: r.source,
        status: r.status === 'awaiting_guest' ? 'in_progress' : r.status,
        category: r.category,
        assigneeId: r.assignee_id,
        contactName: r.contact_name,
        isComplaint: r.is_complaint,
        needsReview: r.needs_review,
        lastActivityAt: r.last_activity_at,
        createdAt: r.created_at,
      })),
      nextCursor,
    });
  } catch (error) {
    next(error);
  }
}

export async function readEnquiryCountsController(_request: Request, response: Response, next: NextFunction): Promise<void> {
  const principal = actor(response);
  const scope = scopeClause(principal, 1);
  const scopeParams = scope.param ? [scope.param] : [];

  try {
    const { rows: byStatus } = await pool.query<{ status: string; n: number }>(
      `SELECT status, count(*)::int AS n FROM enquiries WHERE ${scope.sql} GROUP BY status`,
      scopeParams,
    );
    const { rows: unsorted } = await pool.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM enquiries WHERE ${scope.sql} AND needs_review`,
      scopeParams,
    );
    const { rows: unassigned } = await pool.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM enquiries WHERE ${scope.sql} AND assignee_id IS NULL AND status <> 'resolved'`,
      scopeParams,
    );
    const { rows: complaint } = await pool.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM enquiries WHERE ${scope.sql} AND is_complaint`,
      scopeParams,
    );
    const unreadParams = [...scopeParams, principal.userId];
    const { rows: unread } = await pool.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM enquiries e
        WHERE ${scope.sql} AND NOT EXISTS (
          SELECT 1 FROM enquiry_reads r
           WHERE r.enquiry_id = e.id AND r.user_id = $${unreadParams.length} AND r.last_read_at >= e.last_activity_at
        )`,
      unreadParams,
    );

    const statuses = ['new', 'in_progress', 'resolved'] as const;
    const byStatusMap = Object.fromEntries(statuses.map((s) => [s, 0])) as Record<(typeof statuses)[number], number>;
    for (const row of byStatus) {
      const status = row.status === 'awaiting_guest' ? 'in_progress' : row.status;
      byStatusMap[status as (typeof statuses)[number]] += row.n;
    }

    response.status(200).json({
      byStatus: byStatusMap,
      unsorted: unsorted[0]!.n,
      unassigned: unassigned[0]!.n,
      complaint: complaint[0]!.n,
      unread: unread[0]!.n,
    });
  } catch (error) {
    next(error);
  }
}

async function loadScopedEnquiry(principal: Principal, enquiryId: string): Promise<EnquiryRow | null> {
  const scope = scopeClause(principal, 2);
  const params = scope.param ? [enquiryId, scope.param] : [enquiryId];
  const { rows } = await pool.query<EnquiryRow>(
    `SELECT id, public_ref, source, status, category, assignee_id, contact_name, is_complaint, needs_review,
            last_activity_at, created_at
       FROM enquiries WHERE id = $1 AND ${scope.sql}`,
    params,
  );
  return rows[0] ?? null;
}

/** `assignedOrAbove` is expressed as the row's own scope filter, not middleware (02-
 *  permissions.md) — a thread outside the caller's scope 404s rather than 403ing, the same
 *  ownership-beats-existence pattern the guest tree already uses for quotes/bookings. */
export async function readEnquiryController(request: Request, response: Response, next: NextFunction): Promise<void> {
  const parsed = enquiryDetailQuerySchema.safeParse(request.query);
  if (!parsed.success) return next(badRequest(parsed.error));
  const principal = actor(response);
  const { enquiryId } = request.params as { enquiryId: string };
  const cursor = parsed.data.cursor ? decodeCursor(parsed.data.cursor) : null;
  if (parsed.data.cursor && !cursor) return next(new AppError('validation_failed', 'Invalid cursor.'));

  try {
    const enquiry = await loadScopedEnquiry(principal, enquiryId);
    if (!enquiry) return next(notFound('Enquiry'));

    const messageParams: unknown[] = [enquiry.id];
    let messageCondition = '';
    if (cursor) {
      messageParams.push(cursor.value, cursor.id);
      messageCondition = `AND (created_at, id) < ($2::timestamptz, $3::uuid)`;
    }
    messageParams.push(parsed.data.limit);
    const { rows: messages } = await pool.query<{
      id: string;
      direction: string;
      visibility: string;
      body: string;
      delivery_status: string;
      created_at: string;
      cursor_value: string;
    }>(
      // `created_at::text` for the same reason as the list cursor above — full microsecond
      // precision, not the millisecond-truncated JSON round-trip of a parsed Date.
      `SELECT id, direction, visibility, body, delivery_status, created_at, created_at::text AS cursor_value
         FROM enquiry_messages
        WHERE enquiry_id = $1 ${messageCondition}
        ORDER BY created_at DESC, id DESC
        LIMIT $${messageParams.length}`,
      messageParams,
    );
    const lastMessage = messages[messages.length - 1];
    const nextCursor = messages.length === parsed.data.limit && lastMessage ? encodeCursor(lastMessage.cursor_value, lastMessage.id) : null;

    const { rows: events } = await pool.query<{
      id: string;
      actor_kind: string;
      type: string;
      before: unknown;
      after: unknown;
      created_at: string;
    }>(
      `SELECT id, actor_kind, type, before, after, created_at FROM enquiry_events
        WHERE enquiry_id = $1 ORDER BY created_at DESC`,
      [enquiry.id],
    );

    const { rows: drafts } = await pool.query<{ id: string; body: string; quote_block: unknown; flags: string[]; created_at: string }>(
      `SELECT id, body, quote_block, flags, created_at FROM ai_drafts
        WHERE enquiry_id = $1 AND state = 'pending' ORDER BY created_at DESC LIMIT 1`,
      [enquiry.id],
    );

    response.status(200).json({
      enquiryId: enquiry.id,
      publicRef: enquiry.public_ref,
      source: enquiry.source,
      status: enquiry.status === 'awaiting_guest' ? 'in_progress' : enquiry.status,
      category: enquiry.category,
      assigneeId: enquiry.assignee_id,
      contactName: enquiry.contact_name,
      isComplaint: enquiry.is_complaint,
      needsReview: enquiry.needs_review,
      messages: {
        // Guest-visible messages and internal notes come back clearly separated (IB-6) —
        // never merged into one undifferentiated feed.
        items: messages.map((m) => ({
          id: m.id,
          direction: m.direction,
          visibility: m.visibility,
          body: m.body,
          deliveryStatus: m.delivery_status,
          createdAt: m.created_at,
        })),
        nextCursor,
      },
      history: events.map((e) => ({ id: e.id, actorKind: e.actor_kind, type: e.type, before: e.before, after: e.after, createdAt: e.created_at })),
      pendingDraft: drafts[0]
        ? { id: drafts[0].id, body: drafts[0].body, quoteBlock: drafts[0].quote_block, flags: drafts[0].flags, createdAt: drafts[0].created_at }
        : null,
    });
  } catch (error) {
    next(error);
  }
}

export async function markEnquiryReadController(request: Request, response: Response, next: NextFunction): Promise<void> {
  const principal = actor(response);
  const { enquiryId } = request.params as { enquiryId: string };

  try {
    const enquiry = await loadScopedEnquiry(principal, enquiryId);
    if (!enquiry) return next(notFound('Enquiry'));

    await pool.query(
      `INSERT INTO enquiry_reads (enquiry_id, user_id, last_read_at) VALUES ($1, $2, now())
       ON CONFLICT (enquiry_id, user_id) DO UPDATE SET last_read_at = now()`,
      [enquiry.id, principal.userId],
    );
    response.status(200).json({ enquiryId: enquiry.id });
  } catch (error) {
    next(error);
  }
}

/** Re-runs routing against the corrected category, clears `needs_review`, and records
 *  before/after on `enquiry_events` (IB-15). Correcting *to* complaint fires the GM alert
 *  the same way classification will in 2D (INV-18) — `routeEnquiry` always returns
 *  `assigneeId: null` for it, so this never silently keeps a stale assignee. */
export async function updateEnquiryCategoryController(request: Request, response: Response, next: NextFunction): Promise<void> {
  const parsed = updateCategorySchema.safeParse(request.body);
  if (!parsed.success) return next(badRequest(parsed.error));
  const principal = actor(response);
  const { enquiryId } = request.params as { enquiryId: string };

  try {
    await withTransaction(async (client) => {
      const scope = scopeClause(principal, 2);
      const params = scope.param ? [enquiryId, scope.param] : [enquiryId];
      const { rows } = await client.query<{ id: string; public_ref: string; category: string | null; needs_review: boolean }>(
        `SELECT id, public_ref, category, needs_review FROM enquiries WHERE id = $1 AND ${scope.sql} FOR UPDATE`,
        params,
      );
      const enquiry = rows[0];
      if (!enquiry) throw notFound('Enquiry');
      const before = { category: enquiry.category, needsReview: enquiry.needs_review };

      const routing = await routeEnquiry(client, { category: parsed.data.category, needsReview: false });
      await client.query(
        `UPDATE enquiries SET category = $1, needs_review = false, last_activity_at = now() WHERE id = $2`,
        [parsed.data.category, enquiry.id],
      );
      if (routing.assigneeId) {
        await assignEnquiry(client, { enquiryId: enquiry.id, assigneeId: routing.assigneeId, actorUserId: principal.userId, reason: 'manual' });
      }
      if (routing.notifyGm) {
        await notifyComplaintAlert(client, { enquiryId: enquiry.id, publicRef: enquiry.public_ref });
      }
      await client.query(
        `INSERT INTO enquiry_events (enquiry_id, actor_id, actor_kind, type, before, after)
         VALUES ($1, $2, 'employee', 'category_corrected', $3, $4)`,
        [enquiry.id, principal.userId, JSON.stringify(before), JSON.stringify({ category: parsed.data.category, needsReview: false })],
      );
      await recordAuditEvent(client, {
        actorUserId: principal.userId, actorRole: principal.role, action: 'enquiry.category_corrected', targetKind: 'enquiry', targetId: enquiry.id,
        before, after: { category: parsed.data.category, needsReview: false },
      });
    });
    response.status(200).json({ enquiryId, category: parsed.data.category });
  } catch (error) {
    next(error);
  }
}

export async function updateEnquiryStatusController(request: Request, response: Response, next: NextFunction): Promise<void> {
  const parsed = updateStatusSchema.safeParse(request.body);
  if (!parsed.success) return next(badRequest(parsed.error));
  const principal = actor(response);
  const { enquiryId } = request.params as { enquiryId: string };

  try {
    await withTransaction(async (client) => {
      const scope = scopeClause(principal, 2);
      const params = scope.param ? [enquiryId, scope.param] : [enquiryId];
      const { rows } = await client.query<{ id: string; status: string }>(
        `SELECT id, status FROM enquiries WHERE id = $1 AND ${scope.sql} FOR UPDATE`,
        params,
      );
      const enquiry = rows[0];
      if (!enquiry) throw notFound('Enquiry');

      await client.query(
        `UPDATE enquiries SET status = $1, resolved_at = CASE WHEN $1 = 'resolved' THEN now() ELSE NULL END,
                last_activity_at = now()
           WHERE id = $2`,
        [parsed.data.status, enquiry.id],
      );
      await client.query(
        `INSERT INTO enquiry_events (enquiry_id, actor_id, actor_kind, type, before, after)
         VALUES ($1, $2, 'employee', 'status_changed', $3, $4)`,
        [enquiry.id, principal.userId, JSON.stringify({ status: enquiry.status }), JSON.stringify({ status: parsed.data.status })],
      );
    });
    response.status(200).json({ enquiryId, status: parsed.data.status });
  } catch (error) {
    next(error);
  }
}
