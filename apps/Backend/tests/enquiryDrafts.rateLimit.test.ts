/**
 * DR-1..DR-3 — the per-employee ceiling on `POST /api/admin/enquiryDrafts/:enquiryId` and its
 * `/retry` sibling. Both spend a real provider call and both are a button in the console, so
 * they share ONE bucket: a limiter per route would let /retry double the allowance.
 *
 * Nothing here calls the provider. The generate route only enqueues a job, and /retry is only
 * ever reached AFTER the bucket is exhausted, so the limiter rejects it before its controller
 * runs — which is exactly the behaviour under test.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'bun:test';
import type { AddressInfo } from 'node:net';
import { createApp } from '../src/app.ts';
import { pool } from '../src/db.ts';
import { POLICY } from '../src/core/policy.ts';
import { requireTestDatabase, resetDatabase } from './helpers/db.ts';
import { resetRateLimits } from '../src/middleware/rateLimit.ts';
import { createEmployee } from './helpers/factories.ts';

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

async function seedEnquiry(assigneeId: string): Promise<string> {
  const ref = `ENQ-${crypto.randomUUID().slice(0, 8).toUpperCase()}`;
  const { rows } = await pool.query<{ id: string }>(
    `INSERT INTO enquiries (public_ref, source, status, assignee_id, contact_name, contact_email)
     VALUES ($1, 'website', 'in_progress', $2, 'Test Guest', 'test-guest@example.test')
     RETURNING id`,
    [ref, assigneeId],
  );
  return rows[0]!.id;
}

async function generate(enquiryId: string, accessToken: string): Promise<Response> {
  return fetch(`${baseUrl}/api/admin/enquiryDrafts/${enquiryId}`, {
    method: 'POST',
    headers: { authorization: `Bearer ${accessToken}` },
  });
}

describe('enquiry draft rate limit', () => {
  it('DR-1: an employee gets POLICY.ai.maxDraftsPerEmployee calls, then is refused with Retry-After', async () => {
    const staff = await createEmployee({ role: 'staff', team: 'reservations' });
    const enquiryId = await seedEnquiry(staff.id);

    for (let i = 0; i < POLICY.ai.maxDraftsPerEmployee; i += 1) {
      expect((await generate(enquiryId, staff.accessToken)).status).toBe(202);
    }

    const refused = await generate(enquiryId, staff.accessToken);
    expect(refused.status).toBe(429);
    expect(Number(refused.headers.get('retry-after'))).toBeGreaterThan(0);
    expect(((await refused.json()) as { error: { code: string } }).error.code).toBe('rate_limited');
  });

  it('DR-2: the bucket is per employee — a colleague is unaffected', async () => {
    const first = await createEmployee({ role: 'staff', team: 'reservations' });
    const second = await createEmployee({ role: 'staff', team: 'reservations' });
    const mine = await seedEnquiry(first.id);
    const theirs = await seedEnquiry(second.id);

    for (let i = 0; i < POLICY.ai.maxDraftsPerEmployee; i += 1) await generate(mine, first.accessToken);
    expect((await generate(mine, first.accessToken)).status).toBe(429);

    // Same process, same IP, different principal.
    expect((await generate(theirs, second.accessToken)).status).toBe(202);
  });

  it('DR-3: /retry draws on the same bucket, so it cannot be used to double the allowance', async () => {
    const staff = await createEmployee({ role: 'staff', team: 'reservations' });
    const enquiryId = await seedEnquiry(staff.id);

    for (let i = 0; i < POLICY.ai.maxDraftsPerEmployee; i += 1) await generate(enquiryId, staff.accessToken);

    const retry = await fetch(`${baseUrl}/api/admin/enquiryDrafts/${enquiryId}/retry`, {
      method: 'POST',
      headers: { authorization: `Bearer ${staff.accessToken}` },
    });
    expect(retry.status).toBe(429);
  });
});
