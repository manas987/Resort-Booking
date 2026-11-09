/**
 * IB-1..IB-9 (Docs/tests-phase2.md, 2B). IB-10..IB-18 are 2C — drafts, send, claim. IB-12
 * ("regenerate" superseding a draft) is `admin/enquiryDrafts`'s own route and lands with 2D;
 * everything else below is exercised through 2C's real routes.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'bun:test';
import type { AddressInfo } from 'node:net';
import { createApp } from '../src/app.ts';
import { pool } from '../src/db.ts';
import { requireTestDatabase, resetDatabase } from './helpers/db.ts';
import { resetRateLimits } from '../src/middleware/rateLimit.ts';
import { createEmployee, createGuest } from './helpers/factories.ts';
import { processBatch } from '../src/jobs/worker.ts';

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

async function get(path: string, accessToken: string): Promise<Response> {
  return fetch(`${baseUrl}${path}`, { headers: { authorization: `Bearer ${accessToken}` } });
}
async function post(path: string, body: unknown, accessToken: string): Promise<Response> {
  return fetch(`${baseUrl}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${accessToken}` },
    body: JSON.stringify(body),
  });
}
async function patch(path: string, body: unknown, accessToken: string): Promise<Response> {
  return fetch(`${baseUrl}${path}`, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${accessToken}` },
    body: JSON.stringify(body),
  });
}

async function seedDraft(enquiryId: string): Promise<string> {
  const { rows: runRows } = await pool.query<{ id: string }>(
    `INSERT INTO ai_runs (enquiry_id, stage, provider, model, prompt_version, status)
     VALUES ($1, 'draft', 'gemini', 'gemini-test', 'v1', 'ok') RETURNING id`,
    [enquiryId],
  );
  const { rows: draftRows } = await pool.query<{ id: string }>(
    `INSERT INTO ai_drafts (enquiry_id, ai_run_id, body, state) VALUES ($1, $2, 'Draft reply body.', 'pending') RETURNING id`,
    [enquiryId, runRows[0]!.id],
  );
  return draftRows[0]!.id;
}

async function seedEnquiry(opts: {
  status?: 'new' | 'in_progress' | 'awaiting_guest' | 'resolved';
  category?: 'room' | 'wedding' | 'offsite' | 'complaint' | null;
  assigneeId?: string | null;
  isComplaint?: boolean;
  needsReview?: boolean;
  source?: 'website' | 'email' | 'whatsapp';
  guestUserId?: string | null;
  resolvedAt?: boolean;
}): Promise<string> {
  const ref = `ENQ-${crypto.randomUUID().slice(0, 8).toUpperCase()}`; // collision-free, unlike a 4-digit range
  const { rows } = await pool.query<{ id: string }>(
    `INSERT INTO enquiries
       (public_ref, source, status, category, assignee_id, is_complaint, needs_review,
        guest_user_id, contact_name, contact_email, resolved_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'Test Guest', 'test-guest@example.test',
             CASE WHEN $9 THEN now() ELSE NULL END)
     RETURNING id`,
    [
      ref,
      opts.source ?? 'website',
      opts.status ?? 'new',
      opts.category ?? null,
      opts.assigneeId ?? null,
      opts.isComplaint ?? false,
      opts.needsReview ?? false,
      opts.guestUserId ?? null,
      Boolean(opts.resolvedAt),
    ],
  );
  return rows[0]!.id;
}

async function addMessage(enquiryId: string, visibility: 'guest' | 'internal', body: string): Promise<void> {
  await pool.query(
    `INSERT INTO enquiry_messages (enquiry_id, direction, visibility, body)
     VALUES ($1, 'outbound', $2, $3)`,
    [enquiryId, visibility, body],
  );
}

describe('enquiry.inbox — 2B', () => {
  it('IB-1: list is paginated, bounded, summary rows only', async () => {
    const gm = await createEmployee({ role: 'gm' });
    for (let i = 0; i < 40; i += 1) await seedEnquiry({});

    const response = await get('/api/admin/enquiries', gm.accessToken);
    expect(response.status).toBe(200);
    const body = (await response.json()) as { items: Record<string, unknown>[]; nextCursor: string | null };
    expect(body.items.length).toBe(25); // POLICY.pagination.defaultLimit
    expect(body.nextCursor).not.toBeNull();
    for (const item of body.items) expect(item.messages).toBeUndefined();

    const second = await get(`/api/admin/enquiries?cursor=${encodeURIComponent(body.nextCursor!)}`, gm.accessToken);
    const secondBody = (await second.json()) as { items: unknown[] };
    expect(secondBody.items.length).toBe(15);
  });

  it('IB-2/IB-3: counts cover every lane and facet in one request, and match the filtered lists', async () => {
    const gm = await createEmployee({ role: 'gm' });
    await seedEnquiry({ status: 'new' });
    await seedEnquiry({ status: 'new' });
    await seedEnquiry({ status: 'in_progress' });
    await seedEnquiry({ status: 'resolved', resolvedAt: true });
    await seedEnquiry({ isComplaint: true });
    await seedEnquiry({ needsReview: true });
    await seedEnquiry({ assigneeId: null, status: 'new' }); // unassigned

    const countsResponse = await get('/api/admin/enquiries/counts', gm.accessToken);
    expect(countsResponse.status).toBe(200);
    const counts = (await countsResponse.json()) as {
      byStatus: Record<string, number>;
      unsorted: number;
      unassigned: number;
      complaint: number;
      unread: number;
    };
    // 2 plain 'new' + complaint + needsReview + unassigned fixtures, all default status 'new'.
    expect(counts.byStatus.new).toBe(5);
    expect(counts.byStatus.in_progress).toBe(1);
    expect(counts.byStatus.resolved).toBe(1);
    expect(counts.unsorted).toBe(1);
    expect(counts.complaint).toBe(1);
    expect(counts.unassigned).toBe(6); // every seeded row is unassigned except the resolved one

    const comparisons: Array<[string, number]> = [
      ['status=new', counts.byStatus.new!],
      ['complaint=true', counts.complaint],
      ['needsReview=true', counts.unsorted],
      ['unassigned=true', counts.unassigned],
    ];
    for (const [query, expected] of comparisons) {
      const listResponse = await get(`/api/admin/enquiries?${query}&limit=100`, gm.accessToken);
      const listBody = (await listResponse.json()) as { items: unknown[] };
      expect(listBody.items.length).toBe(expected);
    }
  });

  it('IB-4: an arbitrary sort value is rejected', async () => {
    const gm = await createEmployee({ role: 'gm' });
    const response = await get('/api/admin/enquiries?sort=not_a_real_column', gm.accessToken);
    expect(response.status).toBe(400);
  });

  it('IB-5: a SQL-fragment sort value is rejected, no injection', async () => {
    const gm = await createEmployee({ role: 'gm' });
    const response = await get(`/api/admin/enquiries?${encodeURIComponent('sort')}=${encodeURIComponent("id; DROP TABLE enquiries;--")}`, gm.accessToken);
    expect(response.status).toBe(400);
    const { rows } = await pool.query<{ n: number }>(`SELECT count(*)::int AS n FROM enquiries`);
    expect(rows[0]!.n).toBeGreaterThanOrEqual(0); // the table still exists at all
  });

  it('IB-6/IB-7: internal notes are shown to staff, separated, and absent from the guest route', async () => {
    const staff = await createEmployee({ role: 'staff', team: 'reservations' });
    const guest = await createGuest();
    const enquiryId = await seedEnquiry({ assigneeId: staff.id, guestUserId: guest.id });
    await addMessage(enquiryId, 'guest', 'Guest-visible message.');
    await addMessage(enquiryId, 'internal', 'Internal note for the team.');

    const staffDetail = await get(`/api/admin/enquiries/${enquiryId}`, staff.accessToken);
    expect(staffDetail.status).toBe(200);
    const staffBody = (await staffDetail.json()) as { messages: { items: { visibility: string; body: string }[] } };
    const visibilities = staffBody.messages.items.map((m) => m.visibility).sort();
    expect(visibilities).toEqual(['guest', 'internal']);

    const guestDetail = await get(`/api/user/enquiries/${enquiryId}`, guest.accessToken);
    expect(guestDetail.status).toBe(200);
    const guestBody = (await guestDetail.json()) as { messages: { body: string }[] };
    expect(guestBody.messages).toHaveLength(1);
    expect(guestBody.messages[0]!.body).toBe('Guest-visible message.');
  });

  it('IB-8: a long thread is paginated, not fully loaded', async () => {
    const gm = await createEmployee({ role: 'gm' });
    const enquiryId = await seedEnquiry({});
    for (let i = 0; i < 30; i += 1) await addMessage(enquiryId, 'guest', `Message ${i}`);

    const response = await get(`/api/admin/enquiries/${enquiryId}?limit=10`, gm.accessToken);
    expect(response.status).toBe(200);
    const body = (await response.json()) as { messages: { items: unknown[]; nextCursor: string | null } };
    expect(body.messages.items.length).toBe(10);
    expect(body.messages.nextCursor).not.toBeNull();
  });

  it('IB-9: marking read decreases the unread facet only for that employee', async () => {
    // Two GMs, both with full-inbox scope, so the same enquiry is unread for both until one
    // of them reads it — proving enquiry_reads is keyed per-employee, not global.
    const gm1 = await createEmployee({ role: 'gm' });
    const gm2 = await createEmployee({ role: 'gm' });
    const enquiryId = await seedEnquiry({});

    expect(((await (await get('/api/admin/enquiries/counts', gm1.accessToken)).json()) as { unread: number }).unread).toBe(1);
    expect(((await (await get('/api/admin/enquiries/counts', gm2.accessToken)).json()) as { unread: number }).unread).toBe(1);

    const readResponse = await post(`/api/admin/enquiries/${enquiryId}/read`, {}, gm1.accessToken);
    expect(readResponse.status).toBe(200);

    expect(((await (await get('/api/admin/enquiries/counts', gm1.accessToken)).json()) as { unread: number }).unread).toBe(0);
    expect(((await (await get('/api/admin/enquiries/counts', gm2.accessToken)).json()) as { unread: number }).unread).toBe(1);
  });

  it('IB-10: sending a pending draft creates a message, stamps first_staff_reply_at, and marks the draft sent (INV-46)', async () => {
    const staff = await createEmployee({ role: 'staff', team: 'reservations' });
    const enquiryId = await seedEnquiry({ assigneeId: staff.id, category: 'room' });
    const draftId = await seedDraft(enquiryId);

    const response = await post(`/api/admin/enquiryMessages/${enquiryId}`, { body: 'Here is our reply.', draftId }, staff.accessToken);
    expect(response.status).toBe(201);
    await processBatch('test-worker');

    const { rows: enquiryRows } = await pool.query<{ first_staff_reply_at: string | null }>(
      `SELECT first_staff_reply_at FROM enquiries WHERE id = $1`,
      [enquiryId],
    );
    expect(enquiryRows[0]!.first_staff_reply_at).not.toBeNull();
    const { rows: draftRows } = await pool.query<{ state: string }>(`SELECT state FROM ai_drafts WHERE id = $1`, [draftId]);
    expect(draftRows[0]!.state).toBe('sent');
  });

  it.each(['new', 'awaiting_guest', 'resolved'] as const)('a staff reply automatically moves %s to in_progress', async (status) => {
    const staff = await createEmployee({ role: 'staff', team: 'reservations' });
    const enquiryId = await seedEnquiry({ assigneeId: staff.id, status, resolvedAt: status === 'resolved' });
    const response = await post(`/api/admin/enquiryMessages/${enquiryId}`, { body: 'I can help with your stay.' }, staff.accessToken);
    expect(response.status).toBe(201);
    const { rows } = await pool.query<{ status: string; resolved_at: string | null; reopened_count: number; first_staff_reply_at: string | null }>(
      'SELECT status, resolved_at, reopened_count, first_staff_reply_at FROM enquiries WHERE id = $1', [enquiryId],
    );
    expect(rows[0]!.status).toBe('in_progress');
    expect(rows[0]!.resolved_at).toBeNull();
    expect(rows[0]!.reopened_count).toBe(status === 'resolved' ? 1 : 0);
    // Handling started; delivery is still pending and does not count as a delivered response.
    expect(rows[0]!.first_staff_reply_at).toBeNull();
  });

  it('legacy waiting records remain visible in the In progress filter and counts', async () => {
    const gm = await createEmployee({ role: 'gm' });
    const enquiryId = await seedEnquiry({ status: 'awaiting_guest' });
    const list = await get('/api/admin/enquiries?status=in_progress', gm.accessToken);
    const body = await list.json() as { items: Array<{ enquiryId: string; status: string }> };
    expect(body.items.find((item) => item.enquiryId === enquiryId)?.status).toBe('in_progress');
    const detail = await get(`/api/admin/enquiries/${enquiryId}`, gm.accessToken);
    expect((await detail.json() as { status: string }).status).toBe('in_progress');
    const counts = await get('/api/admin/enquiries/counts', gm.accessToken);
    const totals = await counts.json() as { byStatus: Record<string, number> };
    expect(totals.byStatus.in_progress).toBe(1);
    expect(totals.byStatus.awaiting_guest).toBeUndefined();
    const removed = await patch(`/api/admin/enquiries/${enquiryId}/status`, { status: 'awaiting_guest' }, gm.accessToken);
    expect(removed.status).toBe(400);
  });

  it('IB-11: a pending draft with no send action produces no message', async () => {
    const enquiryId = await seedEnquiry({});
    await seedDraft(enquiryId);
    const { rows } = await pool.query<{ n: number }>(`SELECT count(*)::int AS n FROM enquiry_messages WHERE enquiry_id = $1`, [enquiryId]);
    expect(rows[0]!.n).toBe(0);
  });

  it('IB-13: a reply on an email-sourced thread is queued for delivery on the email channel', async () => {
    const staff = await createEmployee({ role: 'staff', team: 'reservations' });
    const enquiryId = await seedEnquiry({ assigneeId: staff.id, source: 'email' });

    const response = await post(`/api/admin/enquiryMessages/${enquiryId}`, { body: 'Replying by email.' }, staff.accessToken);
    expect(response.status).toBe(201);

    const { rows } = await pool.query<{ payload: { channel: string } }>(
      `SELECT payload FROM jobs WHERE type = 'send_message' ORDER BY created_at DESC LIMIT 1`,
    );
    expect(rows[0]!.payload.channel).toBe('email');
  });

  it('IB-14: a failed delivery is visible but never counts as the first reply (INV-26, INV-54)', async () => {
    const staff = await createEmployee({ role: 'staff', team: 'reservations' });
    const enquiryId = await seedEnquiry({ assigneeId: staff.id });

    const sendResponse = await post(`/api/admin/enquiryMessages/${enquiryId}`, { body: 'Reply text.' }, staff.accessToken);
    const { messageId } = (await sendResponse.json()) as { messageId: string };

    // No documented way to force a failed delivery (same precedent as 1H's LR-4/LR-5) —
    // arranged directly, to prove the schema represents and surfaces it correctly.
    await pool.query(`UPDATE enquiry_messages SET delivery_status = 'failed', delivery_error = 'Simulated failure' WHERE id = $1`, [messageId]);

    const detail = await get(`/api/admin/enquiries/${enquiryId}`, staff.accessToken);
    const body = (await detail.json()) as { messages: { items: { id: string; deliveryStatus: string }[] } };
    const message = body.messages.items.find((m) => m.id === messageId);
    expect(message?.deliveryStatus).toBe('failed');

    const { rows } = await pool.query<{ first_staff_reply_at: string | null }>(`SELECT first_staff_reply_at FROM enquiries WHERE id = $1`, [enquiryId]);
    expect(rows[0]!.first_staff_reply_at).toBeNull();
  });

  it('IB-15: correcting the category reroutes, clears needs_review, and records before/after', async () => {
    const salesStaff = await createEmployee({ role: 'staff', team: 'sales' });
    const gm = await createEmployee({ role: 'gm' });
    const enquiryId = await seedEnquiry({ category: 'room', needsReview: true });

    const response = await patch(`/api/admin/enquiries/${enquiryId}/category`, { category: 'wedding' }, gm.accessToken);
    expect(response.status).toBe(200);

    const { rows } = await pool.query<{ category: string; needs_review: boolean; assignee_id: string | null }>(
      `SELECT category, needs_review, assignee_id FROM enquiries WHERE id = $1`,
      [enquiryId],
    );
    expect(rows[0]!.category).toBe('wedding');
    expect(rows[0]!.needs_review).toBe(false);
    expect(rows[0]!.assignee_id).toBe(salesStaff.id);

    const { rows: events } = await pool.query<{ before: { category: string }; after: { category: string } }>(
      `SELECT before, after FROM enquiry_events WHERE enquiry_id = $1 AND type = 'category_corrected'`,
      [enquiryId],
    );
    expect(events).toHaveLength(1);
    expect(events[0]!.before.category).toBe('room');
    expect(events[0]!.after.category).toBe('wedding');
  });

  it('IB-16: correcting the category to complaint fires the GM alert (INV-18)', async () => {
    const gm = await createEmployee({ role: 'gm' });
    const enquiryId = await seedEnquiry({ category: 'room' });

    const response = await patch(`/api/admin/enquiries/${enquiryId}/category`, { category: 'complaint' }, gm.accessToken);
    expect(response.status).toBe(200);

    const { rows } = await pool.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM notifications WHERE enquiry_id = $1 AND type = 'complaint_alert' AND user_id = $2`,
      [enquiryId, gm.id],
    );
    expect(rows[0]!.n).toBe(1);
  });

  it('IB-17/IB-18: claiming an unassigned enquiry succeeds for the matching team, 403s for the other', async () => {
    const reservationsStaff = await createEmployee({ role: 'staff', team: 'reservations' });
    const salesStaff = await createEmployee({ role: 'staff', team: 'sales' });
    const matching = await seedEnquiry({ category: 'room', assigneeId: null });
    const mismatched = await seedEnquiry({ category: 'room', assigneeId: null });

    const okResponse = await post(`/api/admin/enquiryAssignment/${matching}/claim`, {}, reservationsStaff.accessToken);
    expect(okResponse.status).toBe(200);
    const { rows } = await pool.query<{ assignee_id: string | null }>(`SELECT assignee_id FROM enquiries WHERE id = $1`, [matching]);
    expect(rows[0]!.assignee_id).toBe(reservationsStaff.id);

    const badResponse = await post(`/api/admin/enquiryAssignment/${mismatched}/claim`, {}, salesStaff.accessToken);
    expect(badResponse.status).toBe(403);
  });
});
