import type { NextFunction, Request, Response } from 'express';
import { pool, withTransaction } from '../../../db.ts';
import { AppError, badRequest, forbidden, notFound } from '../../../middleware/errors.ts';
import type { Principal } from '../../../core/tokens.ts';
import { assignEnquiry } from '../../../core/enquiry/assignment.ts';
import { assignSchema } from './schema.ts';

/** Same routing rule as `core/enquiry/assignment.ts`'s private `teamFor` — duplicated, not
 *  imported, since it is not part of that file's contract surface (04-contracts.md) and this
 *  is the only other place that needs it. */
function teamForCategory(category: string | null): 'reservations' | 'sales' | null {
  if (category === 'room') return 'reservations';
  if (category === 'wedding' || category === 'offsite') return 'sales';
  return null;
}

/** Active employees and their teams only — no password hash, no username, no email beyond
 *  what routing needs (SP-24 requires neither). */
export async function readAssignableEmployeesController(_request: Request, response: Response, next: NextFunction): Promise<void> {
  try {
    const { rows } = await pool.query<{ id: string; name: string; role: string; team: string | null }>(
      `SELECT id, name, role, team FROM users WHERE kind = 'employee' AND is_active ORDER BY role, team, name`,
    );
    response.status(200).json({ items: rows });
  } catch (error) {
    next(error);
  }
}

export async function assignEnquiryController(request: Request, response: Response, next: NextFunction): Promise<void> {
  const parsed = assignSchema.safeParse(request.body);
  if (!parsed.success) return next(badRequest(parsed.error));
  const principal = response.locals.principal as Principal;
  const { enquiryId } = request.params as { enquiryId: string };

  try {
    await withTransaction(async (client) => {
      const { rows: enquiryRows } = await client.query<{ id: string }>(`SELECT id FROM enquiries WHERE id = $1 FOR UPDATE`, [enquiryId]);
      if (!enquiryRows[0]) throw notFound('Enquiry');

      const { rows: targetRows } = await client.query<{ id: string }>(
        `SELECT id FROM users WHERE id = $1 AND kind = 'employee' AND is_active`,
        [parsed.data.assigneeId],
      );
      if (!targetRows[0]) throw new AppError('validation_failed', 'That employee is not available to assign.');

      await assignEnquiry(client, {
        enquiryId,
        assigneeId: parsed.data.assigneeId,
        actorUserId: principal.userId,
        reason: 'manual',
      });
    });
    response.status(200).json({ enquiryId, assigneeId: parsed.data.assigneeId });
  } catch (error) {
    next(error);
  }
}

/** Own team only (IB-17/IB-18) — gm/owner are not restricted to a team at all, so the check
 *  only applies to `staff`. An already-assigned enquiry cannot be claimed out from under its
 *  current assignee through this route. */
export async function claimEnquiryController(request: Request, response: Response, next: NextFunction): Promise<void> {
  const principal = response.locals.principal as Principal;
  const { enquiryId } = request.params as { enquiryId: string };

  try {
    await withTransaction(async (client) => {
      const { rows } = await client.query<{ id: string; category: string | null; assignee_id: string | null }>(
        `SELECT id, category, assignee_id FROM enquiries WHERE id = $1 FOR UPDATE`,
        [enquiryId],
      );
      const enquiry = rows[0];
      if (!enquiry) throw notFound('Enquiry');
      if (enquiry.assignee_id !== null) throw new AppError('validation_failed', 'Enquiry is already assigned.');

      if (principal.role === 'staff' && teamForCategory(enquiry.category) !== principal.team) {
        throw forbidden();
      }

      await assignEnquiry(client, {
        enquiryId: enquiry.id,
        assigneeId: principal.userId,
        actorUserId: principal.userId,
        reason: 'claim',
      });
    });
    response.status(200).json({ enquiryId, assigneeId: principal.userId });
  } catch (error) {
    next(error);
  }
}
