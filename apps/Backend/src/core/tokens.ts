/**
 * The only place a session is minted, verified, rotated or revoked (Docs/04-contracts.md).
 * No Express types here. Issuer/audience are fixed literals — see Docs/03-decisions.md,
 * "Guest identity design (1D)".
 */
import { randomBytes, createHash } from 'node:crypto';
import { SignJWT, jwtVerify } from 'jose';
import type { Tx } from '../db.ts';
import { pool } from '../db.ts';
import { env } from '../env.ts';
import { POLICY } from './policy.ts';

export type Principal = {
  userId: string;
  kind: 'guest' | 'employee';
  role: 'guest' | 'staff' | 'gm' | 'owner';
  team: 'reservations' | 'sales' | null;
  emailVerified: boolean;
  phoneVerified: boolean;
};

const JWT_ISSUER = 'resort-api';
const JWT_AUDIENCE = 'resort-app';
const secretKey = new TextEncoder().encode(env.JWT_SECRET);

/** HS256, fixed algorithm, issuer and audience set and checked. ~15 min. */
export async function mintAccessToken(principal: Principal): Promise<string> {
  return new SignJWT({ ...principal })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuer(JWT_ISSUER)
    .setAudience(JWT_AUDIENCE)
    .setSubject(principal.userId)
    .setIssuedAt()
    .setExpirationTime(`${POLICY.expiry.accessTokenMinutes}m`)
    .sign(secretKey);
}

/** Verifies algorithm, issuer, audience and expiry. Returns null on any failure — callers
 *  must not distinguish reasons to the client. Does NOT check is_active; middleware does
 *  that against the database on every request (INV-15). */
export async function verifyAccessToken(token: string): Promise<Principal | null> {
  try {
    const { payload } = await jwtVerify(token, secretKey, {
      issuer: JWT_ISSUER,
      audience: JWT_AUDIENCE,
      algorithms: ['HS256'],
    });
    if (
      typeof payload.userId !== 'string' ||
      typeof payload.kind !== 'string' ||
      typeof payload.role !== 'string'
    ) {
      return null;
    }
    return {
      userId: payload.userId,
      kind: payload.kind as Principal['kind'],
      role: payload.role as Principal['role'],
      team: (payload.team as Principal['team'] | undefined) ?? null,
      emailVerified: Boolean(payload.emailVerified),
      phoneVerified: Boolean(payload.phoneVerified),
    };
  } catch {
    return null;
  }
}

function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

async function insertSession(input: {
  userId: string;
  userAgent?: string;
  ipHash?: string;
  rotatedFrom: string | null;
}): Promise<{ token: string; expiresAt: string }> {
  const token = randomBytes(32).toString('hex');
  const expiresAt = new Date(
    Date.now() + POLICY.expiry.refreshSessionDays * 86_400_000,
  ).toISOString();
  await pool.query(
    `INSERT INTO sessions (user_id, token_hash, rotated_from, expires_at, user_agent, ip_hash)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [input.userId, hashToken(token), input.rotatedFrom, expiresAt, input.userAgent ?? null, input.ipHash ?? null],
  );
  return { token, expiresAt };
}

/** Opaque random value returned once to the caller; only its hash is stored. */
export async function issueRefreshSession(input: {
  userId: string;
  userAgent?: string;
  ipHash?: string;
}): Promise<{ token: string; expiresAt: string }> {
  return insertSession({ ...input, rotatedFrom: null });
}

/** Fresh-reads the current role/team/verification/active state from the database — the
 *  check `verifyAccessToken` deliberately does not do (INV-15). Used by every auth middleware
 *  on every request, not just at mint time. */
export async function loadPrincipal(userId: string): Promise<Principal | null> {
  const { rows } = await pool.query<{
    kind: Principal['kind'];
    role: Principal['role'];
    team: Principal['team'];
    email_verified_at: string | null;
    phone_verified_at: string | null;
    is_active: boolean;
  }>(
    `SELECT kind, role, team, email_verified_at, phone_verified_at, is_active
       FROM users WHERE id = $1`,
    [userId],
  );
  const row = rows[0];
  if (!row || !row.is_active) return null;
  return {
    userId,
    kind: row.kind,
    role: row.role,
    team: row.team,
    emailVerified: row.email_verified_at !== null,
    phoneVerified: row.phone_verified_at !== null,
  };
}

const REVOKABLE_REASONS = ['logout', 'rotation', 'employee_disabled', 'reuse_detected'] as const;
type RevokeReason = (typeof REVOKABLE_REASONS)[number];

async function revokeAllLiveSessions(
  client: Pick<Tx, 'query'>,
  userId: string,
  reason: RevokeReason,
): Promise<void> {
  await client.query(
    `UPDATE sessions SET revoked_at = now(), revoked_reason = $2
       WHERE user_id = $1 AND revoked_at IS NULL`,
    [userId, reason],
  );
}

/** Rotates. Reuse of an already-rotated token revokes the whole chain and returns null
 *  (INV-16). */
export async function rotateRefreshSession(
  token: string,
): Promise<{ token: string; expiresAt: string; principal: Principal } | null> {
  const { rows } = await pool.query<{
    id: string;
    user_id: string;
    revoked_at: string | null;
    expires_at: string;
  }>(`SELECT id, user_id, revoked_at, expires_at FROM sessions WHERE token_hash = $1`, [
    hashToken(token),
  ]);
  const session = rows[0];
  if (!session) return null;

  if (session.revoked_at) {
    // The presented token was already rotated away (or logged out) — this is reuse, not a
    // race. Kill every live session for this user, not just this chain's tail (INV-16).
    await revokeAllLiveSessions(pool, session.user_id, 'reuse_detected');
    return null;
  }
  if (new Date(session.expires_at).getTime() <= Date.now()) return null;

  // Claiming the rotation is the atomic step: `revoked_at IS NULL` in the UPDATE, not in the
  // SELECT above. Two concurrent presentations of the same token both passed that read, so
  // whoever loses this UPDATE never rotated anything — and a token presented twice is reuse
  // by INV-16's own definition, so the chain goes. Without the predicate here both callers
  // won and one token produced two live sessions, which is what single-use must not mean.
  const claimed = await pool.query(
    `UPDATE sessions SET revoked_at = now(), revoked_reason = 'rotation'
       WHERE id = $1 AND revoked_at IS NULL`,
    [session.id],
  );
  if (claimed.rowCount === 0) {
    await revokeAllLiveSessions(pool, session.user_id, 'reuse_detected');
    return null;
  }
  const principal = await loadPrincipal(session.user_id);
  if (!principal) return null;
  const { token: newToken, expiresAt } = await insertSession({
    userId: session.user_id,
    rotatedFrom: session.id,
  });
  return { token: newToken, expiresAt, principal };
}

export async function revokeSession(token: string, reason: 'logout'): Promise<void> {
  await pool.query(
    `UPDATE sessions SET revoked_at = now(), revoked_reason = $2
       WHERE token_hash = $1 AND revoked_at IS NULL`,
    [hashToken(token), reason],
  );
}

/** Called when an employee is disabled — kills every live session (INV-15). */
export async function revokeAllSessionsForUser(
  client: Tx,
  userId: string,
  reason: 'employee_disabled',
): Promise<void> {
  await revokeAllLiveSessions(client, userId, reason);
}
