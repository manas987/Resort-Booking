/**
 * Challenge creation, hashing, attempt and resend limits (Docs/10-phase1-backend-guest.md,
 * 1D). Feature-local: only the user tree issues OTPs.
 */
import { createHash, randomInt, timingSafeEqual } from 'node:crypto';
import { pool } from '../../../db.ts';
import { env } from '../../../env.ts';
import { POLICY } from '../../../core/policy.ts';
import { AppError } from '../../../middleware/errors.ts';

export type OtpPurpose = 'guest_signup' | 'guest_login' | 'verify_email' | 'verify_phone';
export type DestinationKind = 'email' | 'phone';

/**
 * Demo code exposure is scoped to this fixed allowlist, never to real destinations — see
 * Docs/03-decisions.md, "Guest identity design (1D)". Seeded reviewer rows do not exist until
 * 1J; this must not depend on sub-phase order.
 */
const DEMO_DESTINATIONS = new Set(['demo@resort.test', '+910000000000']);

function normalizeDestination(kind: DestinationKind, destination: string): string {
  return kind === 'email' ? destination.toLowerCase().trim() : destination.trim();
}

function hashCode(code: string): Buffer {
  return createHash('sha256').update(code).digest();
}

function generateCode(): string {
  return String(randomInt(0, 10 ** POLICY.otp.digits)).padStart(POLICY.otp.digits, '0');
}

const GENERIC_REJECTION = 'That code is invalid or has expired.';

/** Creates or resends a challenge. Enforces the 60s resend cooldown. Never returns the code
 *  except under the scoped demo allowlist (INV-52). */
export async function requestOtp(input: {
  destinationKind: DestinationKind;
  destination: string;
  purpose: OtpPurpose;
}): Promise<{ expiresAt: string; demoCode?: string }> {
  const destination = normalizeDestination(input.destinationKind, input.destination);
  const code = generateCode();
  const expiresAt = new Date(Date.now() + POLICY.otp.expiryMinutes * 60_000).toISOString();

  const { rows: existing } = await pool.query<{ id: string; last_sent_at: string }>(
    `SELECT id, last_sent_at FROM otp_challenges
       WHERE purpose = $1 AND destination = $2 AND consumed_at IS NULL`,
    [input.purpose, destination],
  );
  const live = existing[0];

  if (live) {
    const secondsSinceSend = (Date.now() - new Date(live.last_sent_at).getTime()) / 1_000;
    if (secondsSinceSend < POLICY.otp.resendCooldownSeconds) {
      throw new AppError('rate_limited', 'Please wait before requesting another code.');
    }
    await pool.query(
      `UPDATE otp_challenges
         SET code_hash = $2, expires_at = $3, attempts = 0,
             resend_count = resend_count + 1, last_sent_at = now()
       WHERE id = $1`,
      [live.id, hashCode(code).toString('hex'), expiresAt],
    );
  } else {
    await pool.query(
      `INSERT INTO otp_challenges
         (purpose, destination_kind, destination, code_hash, expires_at)
       VALUES ($1, $2, $3, $4, $5)`,
      [input.purpose, input.destinationKind, destination, hashCode(code).toString('hex'), expiresAt],
    );
  }

  const demoCode = env.DEMO_MODE && DEMO_DESTINATIONS.has(destination) ? code : undefined;
  return { expiresAt, demoCode };
}

/** Verifies and consumes a challenge. Same generic rejection whether the destination has no
 *  live challenge, the code is wrong, or it is expired or locked out — never distinguish
 *  "no such user" from "wrong code" to the caller. */
export async function verifyOtp(input: {
  destinationKind: DestinationKind;
  destination: string;
  purpose: OtpPurpose;
  code: string;
}): Promise<void> {
  const destination = normalizeDestination(input.destinationKind, input.destination);
  const { rows } = await pool.query<{
    id: string;
    code_hash: string;
    expires_at: string;
    attempts: number;
  }>(
    `SELECT id, code_hash, expires_at, attempts FROM otp_challenges
       WHERE purpose = $1 AND destination = $2 AND consumed_at IS NULL`,
    [input.purpose, destination],
  );
  const challenge = rows[0];
  if (!challenge) throw new AppError('validation_failed', GENERIC_REJECTION);
  if (challenge.attempts >= POLICY.otp.maxAttempts) {
    throw new AppError('validation_failed', GENERIC_REJECTION);
  }
  if (new Date(challenge.expires_at).getTime() <= Date.now()) {
    throw new AppError('validation_failed', GENERIC_REJECTION);
  }

  const presented = hashCode(input.code);
  const stored = Buffer.from(challenge.code_hash, 'hex');
  const matches = presented.length === stored.length && timingSafeEqual(presented, stored);

  if (!matches) {
    await pool.query(`UPDATE otp_challenges SET attempts = attempts + 1 WHERE id = $1`, [
      challenge.id,
    ]);
    throw new AppError('validation_failed', GENERIC_REJECTION);
  }

  await pool.query(`UPDATE otp_challenges SET consumed_at = now() WHERE id = $1`, [challenge.id]);
}
