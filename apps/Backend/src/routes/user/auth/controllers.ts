import { randomBytes, createHash } from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';
import { createRemoteJWKSet, jwtVerify } from 'jose';
import { pool } from '../../../db.ts';
import { env, googleRedirectUri, features, isProduction } from '../../../env.ts';
import { AppError, badRequest, unauthenticated } from '../../../middleware/errors.ts';
import { loadPrincipal, mintAccessToken, issueRefreshSession, rotateRefreshSession, revokeSession } from '../../../core/tokens.ts';
import type { Principal } from '../../../core/tokens.ts';
import { registerSchema, otpRequestSchema, otpVerifySchema } from './schema.ts';
import { requestOtp, verifyOtp } from './otp.ts';

const REFRESH_COOKIE = 'resort_refresh';
const GOOGLE_STATE_COOKIE = 'google_oauth_state';

function ipHash(request: Request): string {
  return createHash('sha256').update(request.ip ?? 'unknown').digest('hex');
}

function setRefreshCookie(response: Response, token: string, expiresAt: string): void {
  response.cookie(REFRESH_COOKIE, token, {
    httpOnly: true,
    secure: isProduction,
    sameSite: 'lax',
    path: '/api/user/auth',
    expires: new Date(expiresAt),
  });
}

function clearRefreshCookie(response: Response): void {
  response.clearCookie(REFRESH_COOKIE, { path: '/api/user/auth' });
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

async function respondWithSession(
  response: Response,
  userId: string,
  request: Request,
): Promise<void> {
  const principal = await loadPrincipal(userId);
  if (!principal) throw new AppError('internal_error', 'Account could not be loaded.');
  const accessToken = await mintAccessToken(principal);
  const refresh = await issueRefreshSession({
    userId,
    userAgent: request.get('user-agent') ?? undefined,
    ipHash: ipHash(request),
  });
  setRefreshCookie(response, refresh.token, refresh.expiresAt);
  response.status(200).json({ accessToken, principal });
}

/** Creates the users row. No session yet — the guest logs in by verifying the contact they
 *  just supplied via `guest_signup` OTP (Docs/03-decisions.md). Body role/kind are ignored;
 *  only the shape below is ever written (INV-35). */
export async function registerGuestController(
  request: Request,
  response: Response,
  next: NextFunction,
): Promise<void> {
  const parsed = registerSchema.safeParse(request.body);
  if (!parsed.success) return next(badRequest(parsed.error));
  const { name, email, phone } = parsed.data;

  try {
    const { rows } = await pool.query<{ id: string }>(
      `INSERT INTO users (kind, role, name, email, phone)
       VALUES ('guest', 'guest', $1, $2, $3)
       RETURNING id`,
      [name, email ?? null, phone ?? null],
    );
    response.status(201).json({ userId: rows[0]!.id });
  } catch (error) {
    const pgError = error as { code?: string };
    if (pgError.code === '23505') {
      next(new AppError('validation_failed', 'An account with that email or phone already exists.'));
      return;
    }
    next(error);
  }
}

export async function requestOtpController(
  request: Request,
  response: Response,
  next: NextFunction,
): Promise<void> {
  const parsed = otpRequestSchema.safeParse(request.body);
  if (!parsed.success) return next(badRequest(parsed.error));

  try {
    const result = await requestOtp(parsed.data);
    response.status(200).json(result);
  } catch (error) {
    next(error);
  }
}

export async function verifyOtpController(
  request: Request,
  response: Response,
  next: NextFunction,
): Promise<void> {
  const parsed = otpVerifySchema.safeParse(request.body);
  if (!parsed.success) return next(badRequest(parsed.error));
  const { destinationKind, destination, purpose, code } = parsed.data;

  try {
    if (purpose === 'verify_email' || purpose === 'verify_phone') {
      // Always the calling principal's own account — optionalGuest already populated it.
      const principal = response.locals.principal as Principal | undefined;
      if (!principal) return next(unauthenticated());
      const expectedKind = purpose === 'verify_email' ? 'email' : 'phone';
      if (destinationKind !== expectedKind) {
        return next(new AppError('validation_failed', 'That code is invalid or has expired.'));
      }
      await verifyOtp({ destinationKind, destination, purpose, code });
      const column = destinationKind === 'email' ? 'email' : 'phone';
      const verifiedColumn = destinationKind === 'email' ? 'email_verified_at' : 'phone_verified_at';
      await pool.query(
        `UPDATE users SET ${column} = $1, ${verifiedColumn} = now() WHERE id = $2`,
        [destination.trim(), principal.userId],
      );
      await respondWithSession(response, principal.userId, request);
      return;
    }

    // guest_signup / guest_login: find the account by its (now or already) verified contact.
    await verifyOtp({ destinationKind, destination, purpose, code });
    const column = destinationKind === 'email' ? 'email' : 'phone';
    const verifiedColumn = destinationKind === 'email' ? 'email_verified_at' : 'phone_verified_at';
    const { rows } = await pool.query<{ id: string }>(
      `SELECT id FROM users WHERE kind = 'guest' AND lower(${column}) = lower($1)`,
      [destination.trim()],
    );
    const guest = rows[0];
    if (!guest) {
      next(new AppError('validation_failed', 'That code is invalid or has expired.'));
      return;
    }
    if (purpose === 'guest_signup') {
      await pool.query(`UPDATE users SET ${verifiedColumn} = now() WHERE id = $1`, [guest.id]);
    }
    await respondWithSession(response, guest.id, request);
  } catch (error) {
    next(error);
  }
}

const GOOGLE_AUTH_ENDPOINT = 'https://accounts.google.com/o/oauth2/v2/auth';
const GOOGLE_TOKEN_ENDPOINT = 'https://oauth2.googleapis.com/token';
const GOOGLE_JWKS = createRemoteJWKSet(new URL('https://www.googleapis.com/oauth2/v3/certs'));

export function startGoogleController(_request: Request, response: Response, next: NextFunction): void {
  if (!features.googleSignIn) {
    next(new AppError('feature_unavailable', 'Google sign-in is not configured.'));
    return;
  }
  const state = randomBytes(16).toString('hex');
  response.cookie(GOOGLE_STATE_COOKIE, state, {
    httpOnly: true,
    secure: isProduction,
    sameSite: 'lax',
    path: '/api/user/auth/google',
    maxAge: 5 * 60_000,
  });
  const params = new URLSearchParams({
    client_id: env.GOOGLE_CLIENT_ID!,
    redirect_uri: googleRedirectUri,
    response_type: 'code',
    scope: 'openid email profile',
    state,
    prompt: 'select_account',
  });
  response.redirect(`${GOOGLE_AUTH_ENDPOINT}?${params.toString()}`);
}

/** The link-or-create step, isolated from the network/JWT mechanics above it so it can be
 *  exercised with synthetic claims — no live Google call is required to test this part
 *  (Docs/progress-log.md, 1D entry). Never touches an employee row (INV-35). */
export async function findOrCreateGuestFromGoogle(input: {
  sub: string;
  email: string | null;
  emailVerified: boolean;
  name: string;
}): Promise<{ id: string }> {
  // `kind = 'guest'` matters: an employee who linked Google on the admin side shares this
  // `google_sub`, and without the filter the GUEST callback would mint a session against
  // their employee row — the wrong tree issuing an employee credential. No privilege is
  // gained either way (role is read from the database, not the token), but the two login
  // paths must stay separate.
  const { rows: existing } = await pool.query<{ id: string }>(
    `SELECT id FROM users WHERE kind = 'guest' AND google_sub = $1`,
    [input.sub],
  );
  if (existing[0]) return existing[0];

  if (input.email) {
    const { rows: byEmail } = await pool.query<{ id: string }>(
      `SELECT id FROM users WHERE kind = 'guest' AND lower(email) = lower($1) AND google_sub IS NULL`,
      [input.email],
    );
    if (byEmail[0]) {
      await pool.query(
        `UPDATE users SET google_sub = $1, email_verified_at = CASE WHEN $2 THEN now() ELSE email_verified_at END
           WHERE id = $3`,
        [input.sub, input.emailVerified, byEmail[0].id],
      );
      return byEmail[0];
    }
  }

  // The email may already belong to another account (guest or employee) — users.email is
  // globally unique across kind, so a colliding insert must not touch that row, and a guest
  // row needs SOME contact (users_guest_has_contact). Fall back to a synthetic, non-deliverable
  // placeholder in the reserved .invalid TLD (RFC 2606) rather than fail the sign-in or claim
  // the colliding address (Docs/03-decisions.md).
  const { rows: emailTaken } = input.email
    ? await pool.query<{ id: string }>(`SELECT id FROM users WHERE lower(email) = lower($1)`, [input.email])
    : { rows: [] };
  const emailCollides = Boolean(emailTaken[0]);
  const email = emailCollides ? `google-${input.sub}@accounts.invalid` : input.email;
  const emailVerifiedAt = !emailCollides && email && input.emailVerified ? 'now()' : 'NULL';

  const { rows: created } = await pool.query<{ id: string }>(
    `INSERT INTO users (kind, role, name, email, email_verified_at, google_sub)
     VALUES ('guest', 'guest', $1, $2, ${emailVerifiedAt}, $3)
     RETURNING id`,
    [input.name, email, input.sub],
  );
  return created[0]!;
}

export async function googleCallbackController(
  request: Request,
  response: Response,
  next: NextFunction,
): Promise<void> {
  try {
    if (!features.googleSignIn) {
      next(new AppError('feature_unavailable', 'Google sign-in is not configured.'));
      return;
    }
    const code = typeof request.query.code === 'string' ? request.query.code : null;
    const state = typeof request.query.state === 'string' ? request.query.state : null;
    const expectedState = readCookie(request, GOOGLE_STATE_COOKIE);
    if (!code || !state || !expectedState || state !== expectedState) {
      next(new AppError('validation_failed', 'Google sign-in could not be verified.'));
      return;
    }
    response.clearCookie(GOOGLE_STATE_COOKIE, { path: '/api/user/auth/google' });

    const tokenResponse = await fetch(GOOGLE_TOKEN_ENDPOINT, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: env.GOOGLE_CLIENT_ID!,
        client_secret: env.GOOGLE_CLIENT_SECRET!,
        code,
        redirect_uri: googleRedirectUri,
        grant_type: 'authorization_code',
      }),
    });
    if (!tokenResponse.ok) {
      next(new AppError('validation_failed', 'Google sign-in could not be verified.'));
      return;
    }
    const { id_token: idToken } = (await tokenResponse.json()) as { id_token?: string };
    if (!idToken) {
      next(new AppError('validation_failed', 'Google sign-in could not be verified.'));
      return;
    }

    const { payload } = await jwtVerify(idToken, GOOGLE_JWKS, {
      issuer: ['https://accounts.google.com', 'accounts.google.com'],
      audience: env.GOOGLE_CLIENT_ID,
    });
    const sub = payload.sub;
    if (typeof sub !== 'string') {
      next(new AppError('validation_failed', 'Google sign-in could not be verified.'));
      return;
    }
    const email = typeof payload.email === 'string' ? payload.email : null;
    const emailVerified = Boolean(payload.email_verified);
    const name = typeof payload.name === 'string' ? payload.name : 'Guest';

    const guest = await findOrCreateGuestFromGoogle({ sub, email, emailVerified, name });
    const principal = await loadPrincipal(guest.id);
    if (!principal) throw new AppError('internal_error', 'Account could not be loaded.');
    const accessToken = await mintAccessToken(principal);
    const refresh = await issueRefreshSession({
      userId: guest.id,
      userAgent: request.get('user-agent') ?? undefined,
      ipHash: ipHash(request),
    });
    setRefreshCookie(response, refresh.token, refresh.expiresAt);
    // No frontend route exists yet to receive this (1D is backend-only) — the fragment keeps
    // the token out of server logs and proxy history once one does.
    response.redirect(`${env.APP_ORIGIN}/auth/callback#accessToken=${encodeURIComponent(accessToken)}`);
  } catch (error) {
    next(error);
  }
}

export async function refreshSessionController(
  request: Request,
  response: Response,
  next: NextFunction,
): Promise<void> {
  const token = readCookie(request, REFRESH_COOKIE);
  if (!token) return next(unauthenticated());

  const rotated = await rotateRefreshSession(token);
  if (!rotated) {
    clearRefreshCookie(response);
    next(unauthenticated());
    return;
  }
  setRefreshCookie(response, rotated.token, rotated.expiresAt);
  const accessToken = await mintAccessToken(rotated.principal);
  response.status(200).json({ accessToken, principal: rotated.principal });
}

export async function logoutController(
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
