import type { NextFunction, Request, Response } from 'express';
import { pool } from '../../../db.ts';
import { AppError, badRequest } from '../../../middleware/errors.ts';
import { readAuditQuerySchema } from './schema.ts';

function encodeCursor(createdAt: string, id: number): string {
  return Buffer.from(JSON.stringify({ createdAt, id })).toString('base64');
}
function decodeCursor(cursor: string): { createdAt: string; id: number } | null {
  try {
    const parsed = JSON.parse(Buffer.from(cursor, 'base64').toString('utf8'));
    if (typeof parsed.createdAt === 'string' && typeof parsed.id === 'number') return parsed;
    return null;
  } catch {
    return null;
  }
}

type AuditRow = {
  id: number;
  actor_user_id: string | null;
  actor_role: string | null;
  action: string;
  target_kind: string;
  target_id: string | null;
  before: unknown;
  after: unknown;
  request_id: string | null;
  created_at: string;
  cursor_value: string;
};

/** Owner-only, read-only — no write route exists anywhere for this table (INV-14, the DB
 *  trigger is the real enforcement; this route simply never offers one). */
export async function readAuditController(request: Request, response: Response, next: NextFunction): Promise<void> {
  const parsed = readAuditQuerySchema.safeParse(request.query);
  if (!parsed.success) return next(badRequest(parsed.error));
  const query = parsed.data;
  const cursor = query.cursor ? decodeCursor(query.cursor) : null;
  if (query.cursor && !cursor) return next(new AppError('validation_failed', 'Invalid cursor.'));

  const params: unknown[] = [];
  const conditions: string[] = ['TRUE'];
  if (query.actorUserId) {
    params.push(query.actorUserId);
    conditions.push(`actor_user_id = $${params.length}`);
  }
  if (query.action) {
    params.push(query.action);
    conditions.push(`action = $${params.length}`);
  }
  if (query.targetKind) {
    params.push(query.targetKind);
    conditions.push(`target_kind = $${params.length}`);
  }
  if (query.targetId) {
    params.push(query.targetId);
    conditions.push(`target_id = $${params.length}`);
  }
  if (query.from) {
    params.push(query.from);
    conditions.push(`created_at::date >= $${params.length}::date`);
  }
  if (query.to) {
    params.push(query.to);
    conditions.push(`created_at::date <= $${params.length}::date`);
  }
  if (cursor) {
    params.push(cursor.createdAt, cursor.id);
    conditions.push(`(created_at, id) < ($${params.length - 1}::timestamptz, $${params.length}::bigint)`);
  }
  params.push(query.limit);

  try {
    const { rows } = await pool.query<AuditRow>(
      `SELECT id, actor_user_id, actor_role, action, target_kind, target_id, before, after, request_id,
              created_at, created_at::text AS cursor_value
         FROM audit_events
        WHERE ${conditions.join(' AND ')}
        ORDER BY created_at DESC, id DESC
        LIMIT $${params.length}`,
      params,
    );
    const last = rows[rows.length - 1];
    const nextCursor = rows.length === query.limit && last ? encodeCursor(last.cursor_value, last.id) : null;

    response.status(200).json({
      items: rows.map((r) => ({
        id: r.id,
        actorUserId: r.actor_user_id,
        actorRole: r.actor_role,
        action: r.action,
        targetKind: r.target_kind,
        targetId: r.target_id,
        before: r.before,
        after: r.after,
        requestId: r.request_id,
        createdAt: r.created_at,
      })),
      nextCursor,
    });
  } catch (error) {
    next(error);
  }
}
