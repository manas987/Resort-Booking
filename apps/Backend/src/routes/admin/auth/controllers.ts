import { createHash } from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';
import { createRemoteJWKSet, jwtVerify } from 'jose';
import { pool } from '../../../db.ts';
import { env, isProduction, features } from '../../../env.ts';
import { AppError, badRequest, unauthenticated } from '../../../middleware/errors.ts';
import { loadPrincipal, mintAccessToken, issueRefreshSession, rotateRefreshSession, revokeSession } from '../../../core/tokens.ts';
import type { Principal } from '../../../core/tokens.ts';
import { loginSchema, googleLoginSchema } from './schema.ts';

const REFRESH_COOKIE = 'resort_admin_refresh';
const GOOGLE_JWKS = createRemoteJWKSet(new URL('https://www.googleapis.com/oauth2/v3/certs'));

/** Generic on every failure path (wrong username, wrong password, disabled, not an employee)
 *  — "login failures are generic, never reveal whether a username exists" (02-permissions.md,
 *  11-phase2-backend-staff.md 2A). */
const INVALID_CREDENTIALS = 'Invalid username or password.';

function ipHash(request: Request): string {
  return createHash('sha256').update(request.ip ?? 'unknown').digest('hex');
}

function setRefreshCookie(response: Response, token: string, expiresAt: string): void {
  response.cookie(REFRESH_COOKIE, token, {
    httpOnly: true,
    secure: isProduction,
    sameSite: 'lax',
    path: '/api/admin/auth',
    expires: new Date(expiresAt),
  });
}

function clearRefreshCookie(response: Response): void {
  response.clearCookie(REFRESH_COOKIE, { path: '/api/admin/auth' });
}

function readCookie(request: Request, name: string): string | null {
  const header = request.headers.cookie;
  if (!header) return null;
  for (const part of header.split(';')) {
    const [key, ...rest] = part.trim().split('=');
    if (key === name) return decodeURIComponent(rest.join('='));
  }
  return null;
}

/** The employee's display name and username, for the console's own chrome.
 *
 *  Deliberately NOT part of `Principal` and never inside the JWT: a token carries identity and
 *  authority, and a display name is neither — adding it would widen every token and force a
 *  re-issue whenever someone's name changed. It rides alongside the session response instead.
 *
 *  Without this the console had no way to name the person signed in, and showed a FIXTURE
 *  employee's name in the sidebar and the greeting — the wrong human, confidently. */
async function employeeIdentity(userId: string): Promise<{ name: string; username: string | null }> {
  const { rows } = await pool.query<{ name: string; username: string | null }>(
    `SELECT name, username FROM users WHERE id = $1`,
    [userId],
  );
  return rows[0] ?? { name: 'Employee', username: null };
}

async function respondWithSession(response: Response, userId: string, request: Request): Promise<void> {
  const principal = await loadPrincipal(userId);
  if (!principal) throw new AppError('internal_error', 'Account could not be loaded.');
  const accessToken = await mintAccessToken(principal);
  const refresh = await issueRefreshSession({
    userId,
    userAgent: request.get('user-agent') ?? undefined,
    ipHash: ipHash(request),
  });
  setRefreshCookie(response, refresh.token, refresh.expiresAt);
  response.status(200).json({ accessToken, principal: { ...principal, ...(await employeeIdentity(userId)) } });
}

/** Username/password login. Never reveals which half failed, and never distinguishes
 *  "no such username" from "wrong password" from "disabled" (INV-15). */
export async function loginEmployeeController(
  request: Request,
  response: Response,
  next: NextFunction,
): Promise<void> {
  const parsed = loginSchema.safeParse(request.body);
  if (!parsed.success) return next(badRequest(parsed.error));
  const { username, password } = parsed.data;

  try {
    const { rows } = await pool.query<{ id: string; password_hash: string; is_active: boolean }>(
      `SELECT id, password_hash, is_active FROM users
         WHERE kind = 'employee' AND lower(username) = lower($1)`,
      [username],
    );
    const row = rows[0];
    // Always run a hash comparison, even against a dummy, so a missing username does not
    // answer faster than a wrong password (timing side-channel on existence).
    const hashToCheck = row?.password_hash ?? '$argon2id$v=19$m=65536,t=2,p=1$ZHVtbXlzYWx0$ZHVtbXloYXNo';
    const passwordOk = await Bun.password.verify(password, hashToCheck).catch(() => false);
    if (!row || !row.is_active || !passwordOk) {
      next(unauthenticated(INVALID_CREDENTIALS));
      return;
    }
    await respondWithSession(response, row.id, request);
  } catch (error) {
    next(error);
  }
}

/** Google sign-in, linked to an already-approved employee only — never creates or promotes
 *  an account (INV-35, INV-36). The client posts the Google Identity Services credential
 *  (an id_token) directly; there is no redirect dance on this tree. */
/** The link-only step, isolated from the network/JWT mechanics so it can be exercised with
 *  synthetic claims — no live Google call required to test this part (same precedent as
 *  `user/auth`'s `findOrCreateGuestFromGoogle`, Docs/03-decisions.md). Never creates a row,
 *  never touches role or team, never returns a disabled employee's id (INV-15, INV-35). */
export async function findApprovedEmployeeForGoogle(input: {
  sub: string;
  email: string | null;
  emailVerified: boolean;
}): Promise<{ id: string } | null> {
  if (!input.email || !input.emailVerified) return null;

  const { rows: bySub } = await pool.query<{ id: string; is_active: boolean }>(
    `SELECT id, is_active FROM users WHERE kind = 'employee' AND google_sub = $1`,
    [input.sub],
  );
  let employee = bySub[0] ?? null;

  if (!employee) {
    // First-use binding: an approved employee row with a matching, Google-verified email and
    // no Google identity linked yet.
    const { rows: byEmail } = await pool.query<{ id: string; is_active: boolean }>(
      `SELECT id, is_active FROM users
         WHERE kind = 'employee' AND google_sub IS NULL AND lower(email) = lower($1)`,
      [input.email],
    );
    if (byEmail[0]) {
      await pool.query(`UPDATE users SET google_sub = $1 WHERE id = $2`, [input.sub, byEmail[0].id]);
      employee = byEmail[0];
    }
  }

  if (!employee || !employee.is_active) return null;
  return { id: employee.id };
}

export async function loginEmployeeGoogleController(
  request: Request,
  response: Response,
  next: NextFunction,
): Promise<void> {
  if (!features.googleSignIn) {
    next(new AppError('feature_unavailable', 'Google sign-in is not configured.'));
    return;
  }
  const parsed = googleLoginSchema.safeParse(request.body);
  if (!parsed.success) return next(badRequest(parsed.error));

  try {
    const { payload } = await jwtVerify(parsed.data.idToken, GOOGLE_JWKS, {
      issuer: ['https://accounts.google.com', 'accounts.google.com'],
      audience: env.GOOGLE_CLIENT_ID,
    });
    const sub = payload.sub;
    if (typeof sub !== 'string') {
      next(unauthenticated(INVALID_CREDENTIALS));
      return;
    }
    const email = typeof payload.email === 'string' ? payload.email : null;
    const emailVerified = Boolean(payload.email_verified);

    const employee = await findApprovedEmployeeForGoogle({ sub, email, emailVerified });
    if (!employee) {
      next(unauthenticated(INVALID_CREDENTIALS));
      return;
    }
    await respondWithSession(response, employee.id, request);
  } catch {
    next(unauthenticated(INVALID_CREDENTIALS));
  }
}

export async function refreshEmployeeSessionController(
  request: Request,
  response: Response,
  next: NextFunction,
): Promise<void> {
  const token = readCookie(request, REFRESH_COOKIE);
  if (!token) return next(unauthenticated());

  const rotated = await rotateRefreshSession(token);
  if (!rotated || rotated.principal.kind !== 'employee') {
    clearRefreshCookie(response);
    next(unauthenticated());
    return;
  }
  setRefreshCookie(response, rotated.token, rotated.expiresAt);
  const accessToken = await mintAccessToken(rotated.principal);
  response.status(200).json({
    accessToken,
    principal: { ...rotated.principal, ...(await employeeIdentity(rotated.principal.userId)) },
  });
}

export async function logoutEmployeeController(
  request: Request,
  response: Response,
  _next: NextFunction,
): Promise<void> {
  const token = readCookie(request, REFRESH_COOKIE);
  if (token) await revokeSession(token, 'logout');
  clearRefreshCookie(response);
  response.status(204).end();
}

export function readMeController(_request: Request, response: Response, next: NextFunction): void {
  const principal = response.locals.principal as Principal | undefined;
  if (!principal) {
    next(unauthenticated());
    return;
  }
  response.status(200).json({ principal });
}
