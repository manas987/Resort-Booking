import { beforeAll, afterAll, beforeEach, expect, test } from 'bun:test';
import { createHash } from 'node:crypto';
import { createApp } from '../src/app.ts';
import { pool } from '../src/db.ts';
import { requireTestDatabase, resetDatabase } from './helpers/db.ts';
import { resetRateLimits } from '../src/middleware/rateLimit.ts';
import { createGuest } from './helpers/factories.ts';
import { findOrCreateGuestFromGoogle } from '../src/routes/user/auth/controllers.ts';

requireTestDatabase();
let server: ReturnType<ReturnType<typeof createApp>['listen']>;
let base: string;
beforeAll(() => { server = createApp().listen(0); base = 'http://127.0.0.1:' + (server.address() as { port: number }).port; });
afterAll(() => server.close());
beforeEach(async () => { await resetDatabase(); resetRateLimits(); });
const code = '246810';
async function call(path: string, body?: unknown, token?: string, method = 'POST') {
  return fetch(base + '/api/user' + path, { method, headers: { 'content-type': 'application/json', ...(token ? { authorization: 'Bearer ' + token } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
}
async function arrangeCode(destination: string) {
  await pool.query('UPDATE otp_challenges SET code_hash = $1 WHERE destination = $2 AND consumed_at IS NULL', [createHash('sha256').update(code).digest('hex'), destination]);
}
async function emailLogin(email: string) {
  expect((await call('/auth/otp/request', { destinationKind: 'email', destination: email, purpose: 'guest_login' })).status).toBe(200);
  await arrangeCode(email);
  return call('/auth/otp/verify', { destinationKind: 'email', destination: email, purpose: 'guest_login', code });
}

test('unknown email is created only after proof, then requires phone and confirmed name', async () => {
  const email = 'new-signup@example.test';
  await call('/auth/otp/request', { destinationKind: 'email', destination: email, purpose: 'guest_login' });
  expect((await pool.query('SELECT id FROM users WHERE email = $1', [email])).rowCount).toBe(0);
  await arrangeCode(email);
  const wrong = await call('/auth/otp/verify', { destinationKind: 'email', destination: email, purpose: 'guest_login', code: '000000' });
  expect(wrong.status).toBe(400);
  expect((await pool.query('SELECT id FROM users WHERE email = $1', [email])).rowCount).toBe(0);
  const response = await call('/auth/otp/verify', { destinationKind: 'email', destination: email, purpose: 'guest_login', code });
  expect(response.status).toBe(200);
  const session = await response.json() as { accessToken: string; needsOnboarding: boolean; principal: { userId: string; emailVerified: boolean; phoneVerified: boolean } };
  expect(session.needsOnboarding).toBe(true);
  expect(session.principal.emailVerified).toBe(true);
  expect(session.principal.phoneVerified).toBe(false);
  const phone = '+919876543210';
  expect((await call('/account/contact/verify-start', { destinationKind: 'phone', destination: phone }, session.accessToken)).status).toBe(200);
  await arrangeCode(phone);
  const phoneResponse = await call('/auth/otp/verify', { destinationKind: 'phone', destination: phone, purpose: 'verify_phone', code }, session.accessToken);
  expect(phoneResponse.status).toBe(200);
  const verified = await phoneResponse.json() as { accessToken: string };
  const prematureBooking = await call('/bookings', { quoteId: crypto.randomUUID(), guestName: 'Asha Rao', guestEmail: email, guestPhone: phone }, verified.accessToken);
  expect(prematureBooking.status).toBe(403);
  expect((await pool.query('SELECT onboarding_complete FROM users WHERE id = $1', [session.principal.userId])).rows[0].onboarding_complete).toBe(false);
  expect((await call('/account/profile', { name: 'Asha Rao' }, verified.accessToken, 'PATCH')).status).toBe(200);
  const me = await call('/auth/me', undefined, verified.accessToken, 'GET');
  const identity = await me.json() as { needsOnboarding: boolean; profile: { name: string } };
  expect(identity.needsOnboarding).toBe(false);
  expect(identity.profile.name).toBe('Asha Rao');
});

test('returning email logs into the same account without onboarding', async () => {
  const guest = await createGuest({ email: 'returning@example.test' });
  const response = await emailLogin('returning@example.test');
  const body = await response.json() as { principal: { userId: string }; needsOnboarding: boolean };
  expect(response.status).toBe(200);
  expect(body.principal.userId).toBe(guest.id);
  expect(body.needsOnboarding).toBe(false);
});

test('Google-created accounts retain the suggested name and require onboarding', async () => {
  const guest = await findOrCreateGuestFromGoogle({ sub: 'onboarding-test', email: 'google-new@example.test', emailVerified: true, name: 'Suggested Name' });
  const { rows } = await pool.query('SELECT name, onboarding_complete FROM users WHERE id = $1', [guest.id]);
  expect(rows[0].name).toBe('Suggested Name');
  expect(rows[0].onboarding_complete).toBe(false);
});
