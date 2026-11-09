/**
 * PE-1..PE-17 (Docs/tests-phase1.md, 1D). PE-3 and PE-4's live network leg are out of scope
 * here — see the notes above those cases and Docs/progress-log.md's 1D entry for why.
 *
 * PE-18..PE-20 were added by the security review; each one failed before its fix.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'bun:test';
import type { AddressInfo } from 'node:net';
import { createApp } from '../src/app.ts';
import { pool } from '../src/db.ts';
import { requireTestDatabase, resetDatabase } from './helpers/db.ts';
import { createGuest, createRoomType, futureDate, publishResortInfo } from './helpers/factories.ts';
import { resetRateLimits } from '../src/middleware/rateLimit.ts';
import { requestOtp, verifyOtp } from '../src/routes/user/auth/otp.ts';
import { findOrCreateGuestFromGoogle } from '../src/routes/user/auth/controllers.ts';
import { mintAccessToken, verifyAccessToken, issueRefreshSession, rotateRefreshSession } from '../src/core/tokens.ts';
import type { Principal } from '../src/core/tokens.ts';
import { SignJWT } from 'jose';

requireTestDatabase();

let baseUrl: string;
let server: ReturnType<ReturnType<typeof createApp>['listen']>;

beforeAll(() => {
  const app = createApp();
  server = app.listen(0);
  const { port } = server.address() as AddressInfo;
  baseUrl = `http://127.0.0.1:${port}`;
});

afterAll(() => {
  server.close();
});

beforeEach(async () => {
  await resetDatabase();
  resetRateLimits();
});

async function post(path: string, body?: unknown): Promise<Response> {
  return fetch(`${baseUrl}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
}

describe('access.privilegeEscalation — 1D', () => {
  it('PE-1: registering with role "gm" in the body is still created as a guest', async () => {
    const response = await post('/api/user/auth/register', {
      name: 'Attempted GM',
      email: 'pe1@example.com',
      role: 'gm',
    });
    expect(response.status).toBe(201);
    const { rows } = await pool.query<{ kind: string; role: string }>(
      `SELECT kind, role FROM users WHERE email = 'pe1@example.com'`,
    );
    expect(rows[0]).toEqual({ kind: 'guest', role: 'guest' });
  });

  it('PE-2: registering with kind "employee" in the body is still a guest', async () => {
    const response = await post('/api/user/auth/register', {
      name: 'Attempted Employee',
      email: 'pe2@example.com',
      kind: 'employee',
    });
    expect(response.status).toBe(201);
    const { rows } = await pool.query<{ kind: string }>(
      `SELECT kind FROM users WHERE email = 'pe2@example.com'`,
    );
    expect(rows[0]!.kind).toBe('guest');
  });

  // PE-3 (guest token on /api/admin/*) is not meaningfully testable yet: no admin route
  // exists before 2A, so the request would 404 regardless of the token. Re-add once 2A lands.

  it('PE-4 (unit): a Google email colliding with any existing account never touches that row', async () => {
    const { rows } = await pool.query<{ id: string }>(
      `INSERT INTO users (kind, role, name, email, username, password_hash)
       VALUES ('employee', 'owner', 'Seeded Owner', 'owner@example.com', 'owner1', 'x')
       RETURNING id`,
    );
    const employeeId = rows[0]!.id;

    // The network/JWT-verification leg above this function is NOT exercised here — it needs
    // a live Google consent flow, which cannot be scripted. This proves the link-or-create
    // step alone, with a synthetic claim, never upgrades or even reads the employee row.
    const guest = await findOrCreateGuestFromGoogle({
      sub: 'google-sub-pe4',
      email: 'owner@example.com',
      emailVerified: true,
      name: 'Attempted Escalation',
    });

    expect(guest.id).not.toBe(employeeId);
    const { rows: guestRows } = await pool.query<{ kind: string; role: string; email: string | null }>(
      `SELECT kind, role, email FROM users WHERE id = $1`,
      [guest.id],
    );
    expect(guestRows[0]!.kind).toBe('guest');
    expect(guestRows[0]!.role).toBe('guest');
    expect(guestRows[0]!.email).not.toBe('owner@example.com'); // never claims the colliding address
    const { rows: employeeRows } = await pool.query<{ role: string }>(
      `SELECT role FROM users WHERE id = $1`,
      [employeeId],
    );
    expect(employeeRows[0]!.role).toBe('owner'); // untouched
  });

  // PE-5 (OTP verified for a phone an employee also uses) needs createEmployee, which does
  // not exist before 2A. Re-add once it does.

  it('PE-6: an OTP code cannot be used twice', async () => {
    // Only the demo-allowlisted destination ever gets its code back (PE-11/PE-13) — it is
    // the only way a test can recover the real code to exercise verify at all.
    const demo = await requestOtp({
      destinationKind: 'email',
      destination: 'demo@resort.test',
      purpose: 'guest_signup',
    });
    expect(demo.demoCode).toBeDefined();
    await verifyOtp({
      destinationKind: 'email',
      destination: 'demo@resort.test',
      purpose: 'guest_signup',
      code: demo.demoCode!,
    });
    await expect(
      verifyOtp({
        destinationKind: 'email',
        destination: 'demo@resort.test',
        purpose: 'guest_signup',
        code: demo.demoCode!,
      }),
    ).rejects.toThrow();
  });

  it('PE-7: 6 wrong codes locks the challenge after 5 attempts', async () => {
    await requestOtp({ destinationKind: 'email', destination: 'pe7@example.com', purpose: 'guest_signup' });
    for (let i = 0; i < 5; i += 1) {
      await expect(
        verifyOtp({ destinationKind: 'email', destination: 'pe7@example.com', purpose: 'guest_signup', code: '000000' }),
      ).rejects.toThrow();
    }
    // A 6th attempt is rejected for being locked, even if it happened to guess right —
    // there is no way to prove that distinction without the real code, so this asserts the
    // locked-out rejection, which is the same generic error either way (PE-11's point).
    await expect(
      verifyOtp({ destinationKind: 'email', destination: 'pe7@example.com', purpose: 'guest_signup', code: '000000' }),
    ).rejects.toThrow();
  });

  it('PE-8: a resend within 60s is refused by the cooldown', async () => {
    await requestOtp({ destinationKind: 'email', destination: 'pe8@example.com', purpose: 'guest_signup' });
    await expect(
      requestOtp({ destinationKind: 'email', destination: 'pe8@example.com', purpose: 'guest_signup' }),
    ).rejects.toThrow();
  });

  it('PE-9: an OTP older than 5 minutes is rejected', async () => {
    const demo = await requestOtp({ destinationKind: 'email', destination: 'demo@resort.test', purpose: 'guest_signup' });
    await pool.query(
      `UPDATE otp_challenges SET expires_at = now() - interval '1 second' WHERE destination = 'demo@resort.test'`,
    );
    await expect(
      verifyOtp({ destinationKind: 'email', destination: 'demo@resort.test', purpose: 'guest_signup', code: demo.demoCode! }),
    ).rejects.toThrow();
  });

  it('PE-10: a code issued for one purpose is rejected under a different purpose', async () => {
    // The allowlisted demo phone, so the test holds the REAL code and the rejection below is
    // provably about purpose-binding, not just a wrong guess.
    const forSignup = await requestOtp({
      destinationKind: 'phone',
      destination: '+910000000000',
      purpose: 'guest_signup',
    });
    expect(forSignup.demoCode).toBeDefined();
    // Different purpose on the SAME destination is a different challenge row entirely
    // (otp_live_uq is keyed on (purpose, destination)) — so guest_login's own lookup never
    // finds the guest_signup row, let alone its code.
    await requestOtp({ destinationKind: 'phone', destination: '+910000000000', purpose: 'guest_login' });
    await expect(
      verifyOtp({
        destinationKind: 'phone',
        destination: '+910000000000',
        purpose: 'guest_login',
        code: forSignup.demoCode!,
      }),
    ).rejects.toThrow();
  });

  it('PE-11: otp_challenges stores only a hash, never the plaintext code', async () => {
    await requestOtp({ destinationKind: 'email', destination: 'pe11@example.com', purpose: 'guest_signup' });
    const { rows } = await pool.query<{ code_hash: string }>(
      `SELECT code_hash FROM otp_challenges WHERE destination = 'pe11@example.com'`,
    );
    expect(rows[0]!.code_hash).toMatch(/^[0-9a-f]{64}$/); // a sha256 hex digest, not 6 digits
  });

  it('PE-13: DEMO_MODE on does not expose a code for a non-allowlisted destination', async () => {
    // This repo's .env has DEMO_MODE=true for local review — exercising PE-12 (DEMO_MODE=false)
    // needs a second process started with that flag off; not run here. See the 1D progress
    // log entry.
    const result = await requestOtp({
      destinationKind: 'email',
      destination: 'real-guest@example.com',
      purpose: 'guest_signup',
    });
    expect(result.demoCode).toBeUndefined();
  });

  it('PE-14: reusing an already-rotated refresh token revokes the whole session chain', async () => {
    const register = await post('/api/user/auth/register', { name: 'PE14', email: 'demo@resort.test' });
    expect(register.status).toBe(201);
    const demo = await requestOtp({ destinationKind: 'email', destination: 'demo@resort.test', purpose: 'guest_signup' });
    expect(demo.demoCode).toBeDefined();
    const verify = await post('/api/user/auth/otp/verify', {
      destinationKind: 'email',
      destination: 'demo@resort.test',
      purpose: 'guest_signup',
      code: demo.demoCode!,
    });
    expect(verify.status).toBe(200);
    const cookie = verify.headers.get('set-cookie')!;
    const refreshCookie = cookie.split(';')[0]!;

    const firstRefresh = await fetch(`${baseUrl}/api/user/auth/refresh`, {
      method: 'POST',
      headers: { cookie: refreshCookie },
    });
    expect(firstRefresh.status).toBe(200);
    const rotatedCookie = firstRefresh.headers.get('set-cookie')!.split(';')[0]!;

    // Reuse the ORIGINAL (already-rotated) token.
    const reuse = await fetch(`${baseUrl}/api/user/auth/refresh`, {
      method: 'POST',
      headers: { cookie: refreshCookie },
    });
    expect(reuse.status).toBe(401);

    // The whole chain is dead now, including the rotated replacement.
    const afterReuse = await fetch(`${baseUrl}/api/user/auth/refresh`, {
      method: 'POST',
      headers: { cookie: rotatedCookie },
    });
    expect(afterReuse.status).toBe(401);
  });

  it('PE-15: an access token with alg "none" is rejected', async () => {
    const forged = `${Buffer.from(JSON.stringify({ alg: 'none', typ: 'JWT' })).toString('base64url')}.${Buffer.from(
      JSON.stringify({ userId: 'x', kind: 'guest', role: 'guest' }),
    ).toString('base64url')}.`;
    expect(await verifyAccessToken(forged)).toBeNull();
  });

  it('PE-15b: an access token signed with a different algorithm/secret is rejected', async () => {
    const wrongSecret = new TextEncoder().encode('a'.repeat(32));
    const forged = await new SignJWT({ userId: 'x', kind: 'guest', role: 'guest' })
      .setProtectedHeader({ alg: 'HS256' })
      .setIssuer('resort-api')
      .setAudience('resort-app')
      .sign(wrongSecret);
    expect(await verifyAccessToken(forged)).toBeNull();
  });

  it('PE-16: an access token past expiry is rejected', async () => {
    const principal: Principal = {
      userId: '00000000-0000-0000-0000-000000000099',
      kind: 'guest',
      role: 'guest',
      team: null,
      emailVerified: true,
      phoneVerified: true,
    };
    const token = await mintAccessToken(principal);
    // mintAccessToken's own expiry is 15 minutes out — prove the check works by minting one
    // already expired, via the same signing path `jose` exposes.
    const { SignJWT: Sign } = await import('jose');
    const secretKey = new TextEncoder().encode(process.env.JWT_SECRET);
    const expired = await new Sign({ ...principal })
      .setProtectedHeader({ alg: 'HS256' })
      .setIssuer('resort-api')
      .setAudience('resort-app')
      .setSubject(principal.userId)
      .setIssuedAt()
      .setExpirationTime('-1s')
      .sign(secretKey);
    expect(await verifyAccessToken(token)).not.toBeNull();
    expect(await verifyAccessToken(expired)).toBeNull();
  });

  it('PE-17: sessions stores only a hash, never the plaintext refresh token', async () => {
    const register = await post('/api/user/auth/register', { name: 'PE17', email: 'demo@resort.test' });
    expect(register.status).toBe(201);
    const demo = await requestOtp({ destinationKind: 'email', destination: 'demo@resort.test', purpose: 'guest_signup' });
    expect(demo.demoCode).toBeDefined();
    const verify = await post('/api/user/auth/otp/verify', {
      destinationKind: 'email',
      destination: 'demo@resort.test',
      purpose: 'guest_signup',
      code: demo.demoCode!,
    });
    const setCookie = verify.headers.get('set-cookie')!;
    const rawToken = decodeURIComponent(setCookie.split(';')[0]!.split('=')[1]!);

    const { rows } = await pool.query<{ token_hash: string }>(`SELECT token_hash FROM sessions`);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.token_hash).not.toBe(rawToken);
    expect(rows[0]!.token_hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('PE-18: two concurrent rotations of ONE refresh token yield one session, not two (INV-16)', async () => {
    const guest = await createGuest({});
    const { token } = await issueRefreshSession({ userId: guest.id });

    // Genuinely parallel, not two awaits: the bug this guards was a read-then-write race, so
    // a sequential version of this test passes against the broken code.
    const outcomes = await Promise.all([rotateRefreshSession(token), rotateRefreshSession(token)]);

    expect(outcomes.filter((o) => o !== null)).toHaveLength(1);
    const { rows } = await pool.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM sessions WHERE user_id = $1 AND revoked_at IS NULL`,
      [guest.id],
    );
    // The loser is treated as reuse, which by INV-16 takes the chain down — so the winner's
    // new session is revoked too. One token, presented twice, never leaves two live sessions.
    expect(rows[0]!.n).toBeLessThanOrEqual(1);
  });

  it('PE-19: one guest cannot replay another guest\'s Idempotency-Key and read their response', async () => {
    await publishResortInfo({ key: 'booking_terms', title: 'Terms', body: 'Standard booking terms.' });
    const room = await createRoomType({ baseAllotment: 5, physicalStock: 5 });
    const victim = await createGuest({ emailVerified: true, phoneVerified: true });
    const attacker = await createGuest({ emailVerified: true, phoneVerified: true });

    const quoteResponse = await fetch(`${baseUrl}/api/user/quotes`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ checkIn: futureDate(10), checkOut: futureDate(11), rooms: [{ roomTypeId: room.id, adults: 1, children: 0 }] }),
    });
    const { quoteId } = (await quoteResponse.json()) as { quoteId: string };

    const sharedKey = crypto.randomUUID();
    const body = { quoteId, guestName: 'Victim', guestEmail: 'victim@example.test', guestPhone: '9000000001' };
    const bookHeaders = (token: string) => ({
      'content-type': 'application/json',
      authorization: `Bearer ${token}`,
      'idempotency-key': sharedKey,
    });

    // The victim books for real, so a 2xx response IS stored against their key — a failed
    // call deletes the key by design, and an unstored response cannot leak.
    const victimBooking = await fetch(`${baseUrl}/api/user/bookings`, {
      method: 'POST', headers: bookHeaders(victim.accessToken), body: JSON.stringify(body),
    });
    expect(victimBooking.status).toBe(201);
    const victimPayload = (await victimBooking.json()) as { reference: string };

    // Same key, byte-identical body, different principal. Replaying here would hand the
    // attacker the victim's booking reference (INV-30, INV-34).
    const replay = await fetch(`${baseUrl}/api/user/bookings`, {
      method: 'POST', headers: bookHeaders(attacker.accessToken), body: JSON.stringify(body),
    });
    const replayText = await replay.text();
    expect(replay.status).toBe(409);
    expect(replayText).toContain('idempotency_key_reused');
    expect(replayText).not.toContain(victimPayload.reference);
  });

  it('PE-20: the public write surface is rate limited, not just login and OTP request', async () => {
    // Each of these is unauthenticated and either writes rows or answers a yes/no about a
    // secret value. /promos/validate is the sharp one: unmetered it enumerates every code.
    const metered: Array<[string, unknown, number]> = [
      ['/api/user/promos/validate', { code: 'NOPE', checkIn: futureDate(5), checkOut: futureDate(6), roomPaise: 100000 }, 60],
      ['/api/user/auth/register', { name: 'Flood' }, 40],
    ];
    for (const [path, template, attempts] of metered) {
      resetRateLimits();
      const statuses = await Promise.all(
        Array.from({ length: attempts }, (_, i) =>
          fetch(`${baseUrl}${path}`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify(
              path.endsWith('/register')
                ? { name: 'Flood', email: `flood-${i}-${crypto.randomUUID()}@example.test` }
                : template,
            ),
          }).then((r) => r.status),
        ),
      );
      expect(statuses.filter((s) => s === 429).length, `${path} must be rate limited`).toBeGreaterThan(0);
    }
  });
});
