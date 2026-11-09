/**
 * Append-only audit trail (INV-14). The only writer, per Docs/06-touch-map.md — `audit_events`
 * has no UPDATE/DELETE grant at the schema level either.
 */
import type { Tx } from '../db.ts';

export async function recordAuditEvent(client: Tx, input: {
  actorUserId: string | null;
  actorRole: string | null;
  action: string;
  targetKind: string;
  targetId?: string;
  before?: unknown;
  after?: unknown;
  requestId?: string;
}): Promise<void> {
  await client.query(
    `INSERT INTO audit_events (actor_user_id, actor_role, action, target_kind, target_id, before, after, request_id)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
    [
      input.actorUserId,
      input.actorRole,
      input.action,
      input.targetKind,
      input.targetId ?? null,
      input.before !== undefined ? JSON.stringify(input.before) : null,
      input.after !== undefined ? JSON.stringify(input.after) : null,
      input.requestId ?? null,
    ],
  );
}
