import type { NextFunction, Request, Response } from 'express';
import { pool, withTransaction, PG, isPgError } from '../../../db.ts';
import { AppError, badRequest, forbidden, notFound } from '../../../middleware/errors.ts';
import type { Principal } from '../../../core/tokens.ts';
import { revokeAllSessionsForUser } from '../../../core/tokens.ts';
import { reassignOnEmployeeDisable } from '../../../core/enquiry/assignment.ts';
import { recordAuditEvent } from '../../../core/audit.ts';
import { createStaffSchema, updateStaffSchema } from './schema.ts';

type EmployeeRole = 'staff' | 'gm' | 'owner';

type StaffRow = {
  id: string;
  username: string;
  email: string;
  name: string;
  role: EmployeeRole;
  team: 'reservations' | 'sales' | null;
  is_active: boolean;
};

/** Who may act on whose row at all, independent of any role change — disable/enable never
 *  change `role`, so promotion rules don't apply to them. A GM cannot touch a GM or an owner
 *  row (owner-only); anyone with `requireGm` may touch a staff row. */
function assertCanManageTarget(actorRole: EmployeeRole, targetRole: EmployeeRole): void {
  if ((targetRole === 'owner' || targetRole === 'gm') && actorRole !== 'owner') throw forbidden();
}

/** INV-36 ("no route creates or promotes an owner") plus "GM -> staff only; owner -> GM or
 *  staff" (Docs/11-phase2-backend-staff.md 2A). Used by create (no `targetRole`, no row
 *  exists yet) and update (where `role` may change). */
function assertCanManageRole(actorRole: EmployeeRole, targetRole: EmployeeRole | undefined, desiredRole: EmployeeRole): void {
  if (desiredRole === 'owner') throw forbidden('No route creates or promotes an owner.');
  if (targetRole) assertCanManageTarget(actorRole, targetRole);
  if (desiredRole === 'gm' && actorRole !== 'owner') throw forbidden();
}

function toPublicShape(row: StaffRow) {
  return {
    id: row.id,
    username: row.username,
    email: row.email,
    name: row.name,
    role: row.role,
    team: row.team,
    isActive: row.is_active,
  };
}

export async function readStaffController(_request: Request, response: Response, next: NextFunction): Promise<void> {
  try {
    const { rows } = await pool.query<StaffRow>(
      `SELECT id, username, email, name, role, team, is_active
         FROM users WHERE kind = 'employee' ORDER BY created_at`,
    );
    response.status(200).json({ staff: rows.map(toPublicShape) });
  } catch (error) {
    next(error);
  }
}

export async function createStaffController(request: Request, response: Response, next: NextFunction): Promise<void> {
  const parsed = createStaffSchema.safeParse(request.body);
  if (!parsed.success) return next(badRequest(parsed.error));
  const actor = response.locals.principal as Principal;
  const { username, email, name, role, team, password } = parsed.data;

  try {
    assertCanManageRole(actor.role as EmployeeRole, undefined, role);

    const passwordHash = await Bun.password.hash(password, { algorithm: 'argon2id' });
    const created = await withTransaction(async (client) => {
      const { rows } = await client.query<StaffRow>(
        `INSERT INTO users (kind, role, team, name, email, email_verified_at, username, password_hash)
         VALUES ('employee', $1, $2, $3, $4, now(), $5, $6)
         RETURNING id, username, email, name, role, team, is_active`,
        [role, role === 'staff' ? team : null, name, email, username, passwordHash],
      );
      const row = rows[0]!;
      await recordAuditEvent(client, {
        actorUserId: actor.userId,
        actorRole: actor.role,
        action: 'employee.create',
        targetKind: 'user',
        targetId: row.id,
        after: { username: row.username, email: row.email, name: row.name, role: row.role, team: row.team },
      });
      return row;
    });
    response.status(201).json(toPublicShape(created));
  } catch (error) {
    if (isPgError(error, PG.UNIQUE_VIOLATION)) {
      next(new AppError('validation_failed', 'That username or email is already in use.'));
      return;
    }
    next(error);
  }
}

async function loadEmployee(targetUserId: string): Promise<StaffRow | null> {
  const { rows } = await pool.query<StaffRow>(
    `SELECT id, username, email, name, role, team, is_active
       FROM users WHERE id = $1 AND kind = 'employee'`,
    [targetUserId],
  );
  return rows[0] ?? null;
}

export async function updateStaffController(request: Request, response: Response, next: NextFunction): Promise<void> {
  const parsed = updateStaffSchema.safeParse(request.body);
  if (!parsed.success) return next(badRequest(parsed.error));
  const actor = response.locals.principal as Principal;
  const { targetUserId } = request.params as { targetUserId: string };
  const updates = parsed.data;

  try {
    const target = await loadEmployee(targetUserId);
    if (!target) return next(notFound('Employee'));
    const desiredRole = updates.role ?? target.role;
    assertCanManageRole(actor.role as EmployeeRole, target.role, desiredRole);

    const nextTeam = desiredRole === 'staff' ? (updates.team ?? target.team) : null;
    if (desiredRole === 'staff' && !nextTeam) {
      next(new AppError('validation_failed', 'team is required for role "staff".'));
      return;
    }
    const passwordHash = updates.password ? await Bun.password.hash(updates.password, { algorithm: 'argon2id' }) : null;

    const updated = await withTransaction(async (client) => {
      const { rows } = await client.query<StaffRow>(
        `UPDATE users SET
           username = $1, email = $2, name = $3, role = $4, team = $5,
           password_hash = COALESCE($6, password_hash)
         WHERE id = $7
         RETURNING id, username, email, name, role, team, is_active`,
        [
          updates.username ?? target.username,
          updates.email ?? target.email,
          updates.name ?? target.name,
          desiredRole,
          nextTeam,
          passwordHash,
          targetUserId,
        ],
      );
      const row = rows[0]!;
      await recordAuditEvent(client, {
        actorUserId: actor.userId,
        actorRole: actor.role,
        action: 'employee.update',
        targetKind: 'user',
        targetId: row.id,
        before: { username: target.username, email: target.email, name: target.name, role: target.role, team: target.team },
        after: { username: row.username, email: row.email, name: row.name, role: row.role, team: row.team },
      });
      return row;
    });
    response.status(200).json(toPublicShape(updated));
  } catch (error) {
    if (isPgError(error, PG.UNIQUE_VIOLATION)) {
      next(new AppError('validation_failed', 'That username or email is already in use.'));
      return;
    }
    next(error);
  }
}

export async function disableStaffController(request: Request, response: Response, next: NextFunction): Promise<void> {
  const actor = response.locals.principal as Principal;
  const { targetUserId } = request.params as { targetUserId: string };

  try {
    await withTransaction(async (client) => {
      const { rows } = await client.query<StaffRow>(
        `SELECT id, username, email, name, role, team, is_active
           FROM users WHERE id = $1 AND kind = 'employee' FOR UPDATE`,
        [targetUserId],
      );
      const target = rows[0];
      if (!target) throw notFound('Employee');
      assertCanManageTarget(actor.role as EmployeeRole, target.role);

      if (target.role === 'owner' && target.is_active) {
        const { rows: activeOwners } = await client.query<{ n: number }>(
          `SELECT count(*)::int AS n FROM users WHERE kind = 'employee' AND role = 'owner' AND is_active`,
        );
        if (activeOwners[0]!.n <= 1) throw new AppError('last_owner', 'The last active owner cannot be disabled.');
      }

      await client.query(
        `UPDATE users SET is_active = false, disabled_at = now(), disabled_by = $1 WHERE id = $2`,
        [actor.userId, targetUserId],
      );
      await revokeAllSessionsForUser(client, targetUserId, 'employee_disabled');
      const { movedEnquiryIds } = await reassignOnEmployeeDisable(client, {
        targetUserId,
        actorUserId: actor.userId,
      });
      await recordAuditEvent(client, {
        actorUserId: actor.userId,
        actorRole: actor.role,
        action: 'employee.disable',
        targetKind: 'user',
        targetId: targetUserId,
        after: { movedEnquiryIds },
      });
    });
    response.status(200).json({ id: targetUserId, isActive: false });
  } catch (error) {
    next(error);
  }
}

export async function enableStaffController(request: Request, response: Response, next: NextFunction): Promise<void> {
  const actor = response.locals.principal as Principal;
  const { targetUserId } = request.params as { targetUserId: string };

  try {
    await withTransaction(async (client) => {
      const target = await loadEmployee(targetUserId);
      if (!target) throw notFound('Employee');
      assertCanManageTarget(actor.role as EmployeeRole, target.role);

      await client.query(
        `UPDATE users SET is_active = true, disabled_at = NULL, disabled_by = NULL WHERE id = $1`,
        [targetUserId],
      );
      await recordAuditEvent(client, {
        actorUserId: actor.userId,
        actorRole: actor.role,
        action: 'employee.enable',
        targetKind: 'user',
        targetId: targetUserId,
      });
    });
    response.status(200).json({ id: targetUserId, isActive: true });
  } catch (error) {
    next(error);
  }
}
