/**
 * Backend routing and reply-reopen rules (Docs/04-contracts.md). `routeEnquiry` is the
 * backend's decision — the model only ever suggests a category (2D). No Express types here.
 */
import { randomInt } from 'node:crypto';
import type { Tx } from '../../db.ts';
import { AppError } from '../../middleware/errors.ts';
import { recordAuditEvent } from '../audit.ts';

export type Category = 'room' | 'wedding' | 'offsite' | 'complaint';

const PUBLIC_REF_ALPHABET = '0123456789';
/** `ENQ-` + 4 digits, the same non-sequential-generator shape as `generateReference`
 *  (`core/booking.ts`) — a different alphabet/length, a separate function, never reproducing
 *  the three seeded literals (ENQ-4410/4411/4412, added in 1J). */
export function generateEnquiryRef(): string {
  let ref = 'ENQ-';
  for (let i = 0; i < 4; i += 1) {
    ref += PUBLIC_REF_ALPHABET[randomInt(PUBLIC_REF_ALPHABET.length)];
  }
  return ref;
}

/** room -> reservations, wedding/offsite -> sales. Complaint has no team queue — it goes to
 *  the GM directly (`notifyGm`); routing an assignee for it is a GM decision, not automatic. */
function teamFor(category: Category | null): 'reservations' | 'sales' | null {
  if (category === 'room') return 'reservations';
  if (category === 'wedding' || category === 'offsite') return 'sales';
  return null;
}

/** Backend routing rule. NOT the model's decision — the model only suggests a category.
 *  room -> reservations · wedding/offsite -> sales · complaint -> GM alert ALWAYS, regardless
 *  of confidence (INV-18) · no configured active assignee -> null, i.e. Unassigned. */
export async function routeEnquiry(
  client: Tx,
  input: { category: Category | null; needsReview: boolean },
): Promise<{ assigneeId: string | null; notifyGm: boolean }> {
  const notifyGm = input.category === 'complaint';
  const team = input.needsReview ? null : teamFor(input.category);
  if (!team) return { assigneeId: null, notifyGm };

  // Least-loaded active staff on that team; ties broken by seniority. No documented
  // algorithm exists for this — a simple, deterministic, fair default (Docs/03-decisions.md).
  const { rows } = await client.query<{ id: string }>(
    `SELECT u.id
       FROM users u
       LEFT JOIN enquiries e ON e.assignee_id = u.id AND e.status IN ('new', 'in_progress', 'awaiting_guest')
      WHERE u.kind = 'employee' AND u.role = 'staff' AND u.team = $1 AND u.is_active
      GROUP BY u.id, u.created_at
      ORDER BY count(e.id) ASC, u.created_at ASC
      LIMIT 1`,
    [team],
  );
  return { assigneeId: rows[0]?.id ?? null, notifyGm };
}

async function recordEvent(
  client: Tx,
  input: {
    enquiryId: string;
    actorId: string | null;
    actorKind: 'guest' | 'employee' | 'system' | 'ai';
    type: string;
    before?: unknown;
    after?: unknown;
  },
): Promise<void> {
  await client.query(
    `INSERT INTO enquiry_events (enquiry_id, actor_id, actor_kind, type, before, after)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [
      input.enquiryId,
      input.actorId,
      input.actorKind,
      input.type,
      input.before === undefined ? null : JSON.stringify(input.before),
      input.after === undefined ? null : JSON.stringify(input.after),
    ],
  );
}

export async function assignEnquiry(
  client: Tx,
  input: {
    enquiryId: string;
    assigneeId: string | null;
    actorUserId: string;
    reason: 'auto' | 'manual' | 'claim' | 'employee_disabled';
  },
): Promise<void> {
  const { rows } = await client.query<{ assignee_id: string | null }>(
    `SELECT assignee_id FROM enquiries WHERE id = $1 FOR UPDATE`,
    [input.enquiryId],
  );
  const before = rows[0]?.assignee_id ?? null;
  await client.query(`UPDATE enquiries SET assignee_id = $1 WHERE id = $2`, [input.assigneeId, input.enquiryId]);
  await recordEvent(client, {
    enquiryId: input.enquiryId,
    actorId: input.reason === 'auto' || input.reason === 'employee_disabled' ? null : input.actorUserId,
    actorKind: input.reason === 'auto' || input.reason === 'employee_disabled' ? 'system' : 'employee',
    type: input.assigneeId === null ? 'unassigned' : before === null ? 'assigned' : 'reassigned',
    before: { assigneeId: before },
    after: { assigneeId: input.assigneeId, reason: input.reason },
  });

  // Audited only for a deliberate staff action (AU-4's "enquiry assignment") — 'auto' and
  // 'employee_disabled' are system-driven consequences already fully traceable through
  // `enquiry_events` above, and auditing every auto-route would be noise, not oversight.
  if (input.reason === 'manual' || input.reason === 'claim') {
    await recordAuditEvent(client, {
      actorUserId: input.actorUserId, actorRole: 'employee', action: 'enquiry.assign', targetKind: 'enquiry', targetId: input.enquiryId,
      before: { assigneeId: before }, after: { assigneeId: input.assigneeId, reason: input.reason },
    });
  }
}

/** Guest reply transitions. awaiting_guest|resolved -> in_progress. Keeps the assignee if
 *  still active, else Unassigned (INV-19). */
export async function applyGuestReply(client: Tx, enquiryId: string): Promise<void> {
  const { rows } = await client.query<{ status: string; assignee_id: string | null }>(
    `SELECT status, assignee_id FROM enquiries WHERE id = $1 FOR UPDATE`,
    [enquiryId],
  );
  const enquiry = rows[0];
  if (!enquiry) throw new AppError('not_found', 'Enquiry not found.');

  if (enquiry.status === 'awaiting_guest' || enquiry.status === 'resolved') {
    const wasResolved = enquiry.status === 'resolved';
    await client.query(
      `UPDATE enquiries SET status = 'in_progress', last_activity_at = now(),
              reopened_count = reopened_count + $2
        WHERE id = $1`,
      [enquiryId, wasResolved ? 1 : 0],
    );
    if (wasResolved) {
      await recordEvent(client, { enquiryId, actorId: null, actorKind: 'guest', type: 'reopened' });
    }
  } else {
    await client.query(`UPDATE enquiries SET last_activity_at = now() WHERE id = $1`, [enquiryId]);
  }

  if (enquiry.assignee_id) {
    const { rows: assigneeRows } = await client.query<{ is_active: boolean }>(
      `SELECT is_active FROM users WHERE id = $1`,
      [enquiry.assignee_id],
    );
    if (!assigneeRows[0]?.is_active) {
      await assignEnquiry(client, {
        enquiryId,
        assigneeId: null,
        actorUserId: enquiry.assignee_id,
        reason: 'employee_disabled',
      });
    }
  }
}

/** Moves a disabled employee's UNRESOLVED enquiries to Unassigned, preserving category,
 *  status, messages and history. Resolved threads keep their attribution (INV-17). Arrives
 *  with `admin/staff` (disable), 2A — not called by anything in 1I. */
export async function reassignOnEmployeeDisable(
  client: Tx,
  input: { targetUserId: string; actorUserId: string },
): Promise<{ movedEnquiryIds: string[] }> {
  const { rows } = await client.query<{ id: string }>(
    `SELECT id FROM enquiries WHERE assignee_id = $1 AND status <> 'resolved'`,
    [input.targetUserId],
  );
  for (const row of rows) {
    await assignEnquiry(client, {
      enquiryId: row.id,
      assigneeId: null,
      actorUserId: input.actorUserId,
      reason: 'employee_disabled',
    });
  }
  return { movedEnquiryIds: rows.map((r) => r.id) };
}

/** Added 2C, not in the original contract sketch: `routeEnquiry` returns `notifyGm` but has
 *  no `enquiryId` to address a notification row with, so the caller that routed the enquiry
 *  — and so holds the id — is the one that calls this right after, whenever `notifyGm` is
 *  true (INV-18, every active GM/owner, always, regardless of confidence). One row per
 *  recipient; `notifications` has no uniqueness constraint to dedupe against here because a
 *  given enquiry is only ever routed to 'complaint' once per correction/classification. */
export async function notifyComplaintAlert(client: Tx, input: { enquiryId: string; publicRef: string }): Promise<void> {
  const { rows: recipients } = await client.query<{ id: string }>(
    `SELECT id FROM users WHERE kind = 'employee' AND role IN ('gm', 'owner') AND is_active`,
  );
  for (const recipient of recipients) {
    await client.query(
      `INSERT INTO notifications (user_id, type, enquiry_id, body) VALUES ($1, 'complaint_alert', $2, $3)`,
      [recipient.id, input.enquiryId, `Complaint reported on ${input.publicRef}.`],
    );
  }
}
