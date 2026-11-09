import type { NextFunction, Request, Response } from 'express';
import { pool, withTransaction } from '../../../db.ts';
import { badRequest } from '../../../middleware/errors.ts';
import type { Principal } from '../../../core/tokens.ts';
import { recordAuditEvent } from '../../../core/audit.ts';
import { publishResortInfoSchema, readResortInfoQuerySchema } from './schema.ts';

export async function readResortInfoController(request: Request, response: Response, next: NextFunction): Promise<void> {
  const parsed = readResortInfoQuerySchema.safeParse(request.query);
  if (!parsed.success) return next(badRequest(parsed.error));

  try {
    // `history=true` drops the is_current filter: publishing never edits a row, so every
    // superseded version is still on file and the editor can show what changed and when.
    const conditions = [parsed.data.history ? 'TRUE' : 'is_current'];
    if (parsed.data.key) conditions.push('r.key = $1');
    const { rows } = await pool.query<{
      key: string; title: string; body: string; version: number; is_current: boolean;
      created_at: string; editor: string | null;
    }>(
      `SELECT r.key, r.title, r.body, r.version, r.is_current, r.created_at, u.name AS editor
         FROM resort_info r
         LEFT JOIN users u ON u.id = r.created_by
        WHERE ${conditions.join(' AND ')}
        ORDER BY r.key, r.version DESC`,
      parsed.data.key ? [parsed.data.key] : [],
    );
    response.status(200).json({
      items: rows.map((r) => ({
        key: r.key,
        title: r.title,
        body: r.body,
        version: r.version,
        isCurrent: r.is_current,
        editor: r.editor,
        createdAt: r.created_at,
      })),
    });
  } catch (error) {
    next(error);
  }
}

/** Publishes a new version — "current" is always the highest version for that key
 *  (`resort_info_current_uq`, a partial unique index, enforces exactly one). Never edits a
 *  row in place, same rule as `tax_config`: history stays readable. */
export async function publishResortInfoController(request: Request, response: Response, next: NextFunction): Promise<void> {
  const parsed = publishResortInfoSchema.safeParse(request.body);
  if (!parsed.success) return next(badRequest(parsed.error));
  const actor = response.locals.principal as Principal;
  const { key, title, body } = parsed.data;

  try {
    const published = await withTransaction(async (client) => {
      const { rows: currentRows } = await client.query<{ version: number; title: string; body: string }>(
        `SELECT version, title, body FROM resort_info WHERE key = $1 AND is_current FOR UPDATE`,
        [key],
      );
      const before = currentRows[0] ?? null;
      const nextVersion = (before?.version ?? 0) + 1;

      await client.query(`UPDATE resort_info SET is_current = false WHERE key = $1 AND is_current`, [key]);
      const { rows } = await client.query<{ key: string; title: string; body: string; version: number; created_at: string }>(
        `INSERT INTO resort_info (key, title, body, version, is_current, created_by)
         VALUES ($1, $2, $3, $4, true, $5)
         RETURNING key, title, body, version, created_at`,
        [key, title, body, nextVersion, actor.userId],
      );
      const after = rows[0]!;
      await recordAuditEvent(client, {
        actorUserId: actor.userId, actorRole: actor.role, action: 'resortInfo.publish', targetKind: 'resort_info', targetId: key,
        before: before ? { title: before.title, body: before.body, version: before.version } : null,
        after: { title: after.title, body: after.body, version: after.version },
      });
      return after;
    });
    response.status(200).json({ key: published.key, title: published.title, body: published.body, version: published.version, createdAt: published.created_at });
  } catch (error) {
    next(error);
  }
}
