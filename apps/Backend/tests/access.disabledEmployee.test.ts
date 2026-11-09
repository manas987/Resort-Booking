/**
 * DE-1..DE-12 (Docs/tests-phase2.md, 2A). DE-2's live Google leg is exercised through
 * `findApprovedEmployeeForGoogle` with synthetic claims, same precedent as 1D's
 * `findOrCreateGuestFromGoogle` (Docs/03-decisions.md) — no live Google call is required.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'bun:test';
import type { AddressInfo } from 'node:net';
import { createApp } from '../src/app.ts';
import { pool } from '../src/db.ts';
import { requireTestDatabase, resetDatabase } from './helpers/db.ts';
import { resetRateLimits } from '../src/middleware/rateLimit.ts';
import { createEmployee, TEST_EMPLOYEE_PASSWORD } from './helpers/factories.ts';
import { findApprovedEmployeeForGoogle } from '../src/routes/admin/auth/controllers.ts';

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

async function post(path: string, body: unknown, accessToken?: string): Promise<Response> {
  return fetch(`${baseUrl}${path}`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...(accessToken ? { authorization: `Bearer ${accessToken}` } : {}),
    },
    body: JSON.stringify(body),
  });
}
async function get(path: string, accessToken: string): Promise<Response> {
  return fetch(`${baseUrl}${path}`, { headers: { authorization: `Bearer ${accessToken}` } });
}
async function disableUser(id: string): Promise<void> {
  await pool.query(`UPDATE users SET is_active = false, disabled_at = now() WHERE id = $1`, [id]);
}

describe('access.disabledEmployee — 2A', () => {
  it('DE-1: username/password login is rejected once disabled', async () => {
    const employee = await createEmployee({ role: 'staff', team: 'reservations' });
    await disableUser(employee.id);
    const response = await post('/api/admin/auth/login', {
      username: employee.username,
      password: TEST_EMPLOYEE_PASSWORD,
    });
    expect(response.status).toBe(401);
  });

  it('DE-2: Google login on the linked identity is rejected once disabled (INV-15)', async () => {
    const employee = await createEmployee({ role: 'staff', team: 'sales' });
    // Links the Google identity first, same as a real first-use sign-in would.
    const { rows } = await pool.query<{ email: string }>(`SELECT email FROM users WHERE id = $1`, [employee.id]);
    const sub = `google-sub-${employee.id}`;
    const linked = await findApprovedEmployeeForGoogle({ sub, email: rows[0]!.email, emailVerified: true });
    expect(linked?.id).toBe(employee.id);

    await disableUser(employee.id);
    const rejected = await findApprovedEmployeeForGoogle({ sub, email: rows[0]!.email, emailVerified: true });
    expect(rejected).toBeNull();
  });

  it('DE-3: disabled while holding a valid access token is rejected on the next request (INV-15)', async () => {
    const employee = await createEmployee({ role: 'staff', team: 'reservations' });
    const before = await get('/api/admin/auth/me', employee.accessToken);
    expect(before.status).toBe(200);

    await disableUser(employee.id);
    const after = await get('/api/admin/auth/me', employee.accessToken);
    expect(after.status).toBe(403);
  });

  it('DE-4: a disabled employee\'s refresh token is rejected; sessions revoked with reason employee_disabled', async () => {
    const owner = await createEmployee({ role: 'owner' });
    const staff = await createEmployee({ role: 'staff', team: 'reservations' });

    const loginResponse = await post('/api/admin/auth/login', {
      username: staff.username,
      password: TEST_EMPLOYEE_PASSWORD,
    });
    expect(loginResponse.status).toBe(200);
    const refreshCookie = loginResponse.headers.get('set-cookie')!;
    const cookieValue = refreshCookie.split(';')[0]!;

    const disableResponse = await post(`/api/admin/staff/${staff.id}/disable`, {}, owner.accessToken);
    expect(disableResponse.status).toBe(200);

    const { rows } = await pool.query<{ revoked_reason: string | null }>(
      `SELECT revoked_reason FROM sessions WHERE user_id = $1`,
      [staff.id],
    );
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) expect(row.revoked_reason).toBe('employee_disabled');

    const refreshResponse = await fetch(`${baseUrl}/api/admin/auth/refresh`, {
      method: 'POST',
      headers: { cookie: cookieValue },
    });
    expect(refreshResponse.status).toBe(401);
  });

  async function seedEnquiry(opts: {
    status: 'new' | 'in_progress' | 'awaiting_guest' | 'resolved';
    assigneeId: string | null;
    resolvedAt?: boolean;
  }): Promise<string> {
    const ref = `ENQ-${crypto.randomUUID().slice(0, 8).toUpperCase()}`; // collision-free, unlike a 4-digit range
    const { rows } = await pool.query<{ id: string }>(
      `INSERT INTO enquiries (public_ref, source, status, category, assignee_id, contact_name, contact_email, resolved_at)
       VALUES ($1, 'website', $2, 'room', $3, 'Test Guest', 'test-guest@example.test',
               CASE WHEN $4 THEN now() ELSE NULL END)
       RETURNING id`,
      [ref, opts.status, opts.assigneeId, Boolean(opts.resolvedAt)],
    );
    return rows[0]!.id;
  }

  it('DE-5/DE-6: disabling moves unresolved assigned enquiries to Unassigned and preserves resolved attribution', async () => {
    const owner = await createEmployee({ role: 'owner' });
    const staff = await createEmployee({ role: 'staff', team: 'reservations' });

    const open1 = await seedEnquiry({ status: 'in_progress', assigneeId: staff.id });
    const open2 = await seedEnquiry({ status: 'new', assigneeId: staff.id });
    const open3 = await seedEnquiry({ status: 'awaiting_guest', assigneeId: staff.id });
    const resolved1 = await seedEnquiry({ status: 'resolved', assigneeId: staff.id, resolvedAt: true });
    const resolved2 = await seedEnquiry({ status: 'resolved', assigneeId: staff.id, resolvedAt: true });

    const response = await post(`/api/admin/staff/${staff.id}/disable`, {}, owner.accessToken);
    expect(response.status).toBe(200);

    const { rows: unresolved } = await pool.query<{ id: string; assignee_id: string | null; status: string; category: string }>(
      `SELECT id, assignee_id, status, category FROM enquiries WHERE id = ANY($1)`,
      [[open1, open2, open3]],
    );
    for (const row of unresolved) {
      expect(row.assignee_id).toBeNull();
      expect(row.category).toBe('room'); // category preserved
    }

    const { rows: resolved } = await pool.query<{ id: string; assignee_id: string | null }>(
      `SELECT id, assignee_id FROM enquiries WHERE id = ANY($1)`,
      [[resolved1, resolved2]],
    );
    for (const row of resolved) expect(row.assignee_id).toBe(staff.id); // still attributed
  });

  it('DE-7: a reopened resolved thread of a disabled employee goes in_progress and Unassigned (INV-19)', async () => {
    const owner = await createEmployee({ role: 'owner' });
    const staff = await createEmployee({ role: 'staff', team: 'reservations' });
    const resolved = await seedEnquiry({ status: 'resolved', assigneeId: staff.id, resolvedAt: true });

    await post(`/api/admin/staff/${staff.id}/disable`, {}, owner.accessToken);
    // Still attributed right after disable (resolved threads keep attribution, DE-6).
    const { rows: beforeReopen } = await pool.query<{ assignee_id: string | null }>(
      `SELECT assignee_id FROM enquiries WHERE id = $1`,
      [resolved],
    );
    expect(beforeReopen[0]!.assignee_id).toBe(staff.id);

    const { applyGuestReply } = await import('../src/core/enquiry/assignment.ts');
    const { withTransaction } = await import('../src/db.ts');
    await withTransaction((client) => applyGuestReply(client, resolved));

    const { rows } = await pool.query<{ status: string; assignee_id: string | null }>(
      `SELECT status, assignee_id FROM enquiries WHERE id = $1`,
      [resolved],
    );
    expect(rows[0]!.status).toBe('in_progress');
    expect(rows[0]!.assignee_id).toBeNull();
  });

  it('DE-8: a new matching enquiry never auto-assigns to a disabled primary assignee', async () => {
    const owner = await createEmployee({ role: 'owner' });
    const staff = await createEmployee({ role: 'staff', team: 'reservations' });
    await post(`/api/admin/staff/${staff.id}/disable`, {}, owner.accessToken);

    const { routeEnquiry } = await import('../src/core/enquiry/assignment.ts');
    const { withTransaction } = await import('../src/db.ts');
    const { assigneeId, notifyGm } = await withTransaction((client) =>
      routeEnquiry(client, { category: 'room', needsReview: false }),
    );
    expect(assigneeId).toBeNull();
    expect(notifyGm).toBe(false);
  });

  it('DE-9: GM reassigns a disabled employee\'s old enquiry successfully', async () => {
    const gm = await createEmployee({ role: 'gm' });
    const staff1 = await createEmployee({ role: 'staff', team: 'reservations' });
    const staff2 = await createEmployee({ role: 'staff', team: 'reservations' });
    const enquiryId = await seedEnquiry({ status: 'in_progress', assigneeId: staff1.id });
    await post(`/api/admin/staff/${staff1.id}/disable`, {}, gm.accessToken);

    const { assignEnquiry } = await import('../src/core/enquiry/assignment.ts');
    const { withTransaction } = await import('../src/db.ts');
    await withTransaction((client) =>
      assignEnquiry(client, { enquiryId, assigneeId: staff2.id, actorUserId: gm.id, reason: 'manual' }),
    );
    const { rows } = await pool.query<{ assignee_id: string | null }>(`SELECT assignee_id FROM enquiries WHERE id = $1`, [enquiryId]);
    expect(rows[0]!.assignee_id).toBe(staff2.id);
  });

  it('DE-10: re-enabling does not restore old assignments', async () => {
    const owner = await createEmployee({ role: 'owner' });
    const staff = await createEmployee({ role: 'staff', team: 'reservations' });
    const enquiryId = await seedEnquiry({ status: 'in_progress', assigneeId: staff.id });

    await post(`/api/admin/staff/${staff.id}/disable`, {}, owner.accessToken);
    const enableResponse = await post(`/api/admin/staff/${staff.id}/enable`, {}, owner.accessToken);
    expect(enableResponse.status).toBe(200);

    const { rows: userRows } = await pool.query<{ is_active: boolean }>(`SELECT is_active FROM users WHERE id = $1`, [staff.id]);
    expect(userRows[0]!.is_active).toBe(true);
    const { rows: enquiryRows } = await pool.query<{ assignee_id: string | null }>(
      `SELECT assignee_id FROM enquiries WHERE id = $1`,
      [enquiryId],
    );
    expect(enquiryRows[0]!.assignee_id).toBeNull();
  });

  it('DE-11: a disabled employee row still exists with is_active = false — never deleted', async () => {
    const owner = await createEmployee({ role: 'owner' });
    const staff = await createEmployee({ role: 'staff', team: 'sales' });
    await post(`/api/admin/staff/${staff.id}/disable`, {}, owner.accessToken);

    const { rows } = await pool.query<{ id: string; is_active: boolean }>(`SELECT id, is_active FROM users WHERE id = $1`, [staff.id]);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.is_active).toBe(false);
  });

  it('DE-12: the disable is recorded in the audit log with the actor, and carries no password or token', async () => {
    const owner = await createEmployee({ role: 'owner' });
    const staff = await createEmployee({ role: 'staff', team: 'sales' });
    await post(`/api/admin/staff/${staff.id}/disable`, {}, owner.accessToken);

    const { rows } = await pool.query<{ actor_user_id: string; action: string; before: unknown; after: unknown }>(
      `SELECT actor_user_id, action, before, after FROM audit_events WHERE action = 'employee.disable' AND target_id = $1`,
      [staff.id],
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]!.actor_user_id).toBe(owner.id);
    const serialized = JSON.stringify(rows[0]);
    expect(serialized).not.toMatch(/password/i);
    expect(serialized.toLowerCase()).not.toContain(TEST_EMPLOYEE_PASSWORD.toLowerCase());
  });
});
