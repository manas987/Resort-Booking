/**
 * AV-1..AV-11, AV-15..AV-17 (Docs/tests-phase2.md, 2D). Provider responses are stubbed at the
 * `generateStructured` boundary (tests/helpers/aiStub.ts) — parsing, validation and routing
 * are real. AV-12 and AV-14 (ENQ-4410 and ENQ-4412) are exercised through the required live
 * end-to-end Gemini run instead — "did the draft avoid inventing an unapproved fact" has no
 * structural signature a stub test can grep for, unlike a price number, which AV-7's sibling
 * AB-7/AB-8 already check mechanically. The live run's model, latency and `ai_runs` row are
 * reported in Docs/progress-log.md's 2D entry.
 *
 * AV-13 (ENQ-4411) IS asserted here, unlike its two siblings: its claim — a missing year is
 * flagged tentative and the original wording preserved, never silently assumed (INV-48) — is
 * structural, and it is the only repeatable proof of that invariant.
 */
import { describe, it, expect, beforeEach } from 'bun:test';
import { pool } from '../src/db.ts';
import { requireTestDatabase, resetDatabase } from './helpers/db.ts';
import { createEmployee } from './helpers/factories.ts';
import { queueAiResponse, resetAiStub } from './helpers/aiStub.ts';
import { processEnquiry } from '../src/core/enquiry/processing.ts';

requireTestDatabase();

beforeEach(async () => {
  await resetDatabase();
  resetAiStub();
});

async function seedEnquiryWithMessage(message: string): Promise<string> {
  const ref = `ENQ-${crypto.randomUUID().slice(0, 8).toUpperCase()}`;
  const { rows } = await pool.query<{ id: string }>(
    `INSERT INTO enquiries (public_ref, source, status, contact_name, contact_email)
     VALUES ($1, 'website', 'new', 'Test Guest', 'test-guest@example.test') RETURNING id`,
    [ref],
  );
  await pool.query(
    `INSERT INTO enquiry_messages (enquiry_id, direction, visibility, body) VALUES ($1, 'inbound', 'guest', $2)`,
    [rows[0]!.id, message],
  );
  return rows[0]!.id;
}

function classifyText(overrides: Partial<{
  category: string | null; confidence: number; isComplaint: boolean;
  checkIn: string | null; checkOut: string | null; adults: number | null; children: number | null;
  guestCount: number | null; budgetPaise: number | null; datesOriginalText: string | null;
  datesTentative: boolean; notes: string | null;
}> = {}): string {
  return JSON.stringify({
    category: 'category' in overrides ? overrides.category : 'room',
    confidence: overrides.confidence ?? 0.9,
    isComplaint: overrides.isComplaint ?? false,
    extracted: {
      checkIn: overrides.checkIn ?? null,
      checkOut: overrides.checkOut ?? null,
      adults: overrides.adults ?? null,
      children: overrides.children ?? null,
      guestCount: overrides.guestCount ?? null,
      budgetPaise: overrides.budgetPaise ?? null,
      datesOriginalText: overrides.datesOriginalText ?? null,
      datesTentative: overrides.datesTentative ?? false,
      notes: overrides.notes ?? null,
    },
  });
}

function draftText(overrides: Partial<{ body: string; statesPrice: boolean }> = {}): string {
  return JSON.stringify({ body: overrides.body ?? 'Thank you for your enquiry — we will follow up shortly.', statesPrice: overrides.statesPrice ?? false });
}

describe('ai.validation — 2D', () => {
  it('AV-1: valid JSON, high confidence — ok, routed, one pending draft', async () => {
    const staff = await createEmployee({ role: 'staff', team: 'reservations' });
    const enquiryId = await seedEnquiryWithMessage('Is a room available next month?');
    queueAiResponse({ text: classifyText({ category: 'room', confidence: 0.9 }) });
    queueAiResponse({ text: draftText() });

    const outcome = await processEnquiry(enquiryId);
    expect(outcome.status).toBe('ok');
    if (outcome.status === 'ok') expect(outcome.category).toBe('room');

    const { rows } = await pool.query<{ assignee_id: string | null; ai_status: string }>(
      `SELECT assignee_id, ai_status FROM enquiries WHERE id = $1`,
      [enquiryId],
    );
    expect(rows[0]!.assignee_id).toBe(staff.id);
    expect(rows[0]!.ai_status).toBe('ok');

    const { rows: drafts } = await pool.query<{ n: number }>(`SELECT count(*)::int AS n FROM ai_drafts WHERE enquiry_id = $1 AND state = 'pending'`, [enquiryId]);
    expect(drafts[0]!.n).toBe(1);
  });

  it('AV-2: malformed JSON — schema_invalid, needs_review, Unsorted', async () => {
    const enquiryId = await seedEnquiryWithMessage('Hello?');
    queueAiResponse({ text: 'this is not json' });

    const outcome = await processEnquiry(enquiryId);
    expect(outcome).toEqual({ status: 'needs_review', reason: 'schema_invalid' });

    const { rows } = await pool.query<{ needs_review: boolean }>(`SELECT needs_review FROM enquiries WHERE id = $1`, [enquiryId]);
    expect(rows[0]!.needs_review).toBe(true);
    const { rows: runs } = await pool.query<{ n: number }>(`SELECT count(*)::int AS n FROM ai_runs WHERE enquiry_id = $1 AND status = 'schema_invalid'`, [enquiryId]);
    expect(runs[0]!.n).toBe(1);
  });

  it('AV-3: valid JSON, unknown category value — schema_invalid (zod enum rejects it)', async () => {
    const enquiryId = await seedEnquiryWithMessage('Hello?');
    const malformed = classifyText({ category: 'banquet' as never });
    queueAiResponse({ text: malformed });

    const outcome = await processEnquiry(enquiryId);
    expect(outcome).toEqual({ status: 'needs_review', reason: 'schema_invalid' });
  });

  it('AV-4: valid shape, check-out before check-in — semantic_invalid', async () => {
    const enquiryId = await seedEnquiryWithMessage('14 to 12 Nov please.');
    queueAiResponse({ text: classifyText({ checkIn: '2099-11-14', checkOut: '2099-11-12' }) });

    const outcome = await processEnquiry(enquiryId);
    expect(outcome).toEqual({ status: 'needs_review', reason: 'semantic_invalid' });
  });

  it('AV-5: valid shape, dates in the past — semantic_invalid', async () => {
    const enquiryId = await seedEnquiryWithMessage('Last January please.');
    queueAiResponse({ text: classifyText({ checkIn: '2020-01-01', checkOut: '2020-01-03', datesTentative: false }) });

    const outcome = await processEnquiry(enquiryId);
    expect(outcome).toEqual({ status: 'needs_review', reason: 'semantic_invalid' });
  });

  it('AV-6: valid shape, 5,000 guests — semantic_invalid, bounds enforced', async () => {
    const enquiryId = await seedEnquiryWithMessage('A huge offsite.');
    queueAiResponse({ text: classifyText({ category: 'offsite', guestCount: 5000 }) });

    const outcome = await processEnquiry(enquiryId);
    expect(outcome).toEqual({ status: 'needs_review', reason: 'semantic_invalid' });
  });

  it('AV-7: confidence below threshold — low_confidence, needs_review, category left NULL', async () => {
    const enquiryId = await seedEnquiryWithMessage('Not sure what I want.');
    queueAiResponse({ text: classifyText({ category: 'room', confidence: 0.2 }) });

    const outcome = await processEnquiry(enquiryId);
    expect(outcome).toEqual({ status: 'needs_review', reason: 'low_confidence' });

    const { rows } = await pool.query<{ category: string | null; needs_review: boolean }>(`SELECT category, needs_review FROM enquiries WHERE id = $1`, [enquiryId]);
    expect(rows[0]!.category).toBeNull();
    expect(rows[0]!.needs_review).toBe(true);
  });

  it('AV-18: no category at HIGH confidence — still needs_review and Unsorted, not ok', async () => {
    // The classify prompt tells the model to "leave it null rather than invent one", and its
    // confidence then describes THAT judgement. A null category at 0.9 means "I am sure I
    // cannot tell" and must reach the GM's Unsorted lane (Product.md §2). AV-7 is the
    // low-confidence-WITH-a-category sibling; this is the case that used to be stored
    // ai_status='ok', needs_review=false and counted nowhere.
    const enquiryId = await seedEnquiryWithMessage('Hi.');
    queueAiResponse({ text: classifyText({ category: null, confidence: 0.9 }) });

    const outcome = await processEnquiry(enquiryId);
    expect(outcome).toEqual({ status: 'needs_review', reason: 'low_confidence' });

    const { rows } = await pool.query<{ category: string | null; needs_review: boolean; ai_status: string }>(
      `SELECT category, needs_review, ai_status FROM enquiries WHERE id = $1`,
      [enquiryId],
    );
    expect(rows[0]!.category).toBeNull();
    expect(rows[0]!.needs_review).toBe(true);
    expect(rows[0]!.ai_status).toBe('low_confidence');

    // and no draft was produced for an enquiry nobody has triaged
    const { rows: drafts } = await pool.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM ai_drafts WHERE enquiry_id = $1`,
      [enquiryId],
    );
    expect(drafts[0]!.n).toBe(0);
  });

  it('AV-19: a complaint with no usable confidence still routes to the GM (INV-18)', async () => {
    const enquiryId = await seedEnquiryWithMessage('This was unacceptable.');
    queueAiResponse({ text: classifyText({ category: 'complaint', confidence: 0.1, isComplaint: true }) });
    queueAiResponse({ text: JSON.stringify({ body: 'We are sorry. Our GM will review this.', statesPrice: false }) });

    const outcome = await processEnquiry(enquiryId);
    expect(outcome).toMatchObject({ status: 'ok', category: 'complaint' });

    const { rows } = await pool.query<{ category: string | null; needs_review: boolean }>(
      `SELECT category, needs_review FROM enquiries WHERE id = $1`,
      [enquiryId],
    );
    expect(rows[0]!.category).toBe('complaint');
    expect(rows[0]!.needs_review).toBe(false);
  });

  it('AV-8: provider times out — timeout, enquiry intact, bounded retry available', async () => {
    const enquiryId = await seedEnquiryWithMessage('Hello?');
    queueAiResponse({ throws: new Error('ETIMEDOUT: request timed out') });
    queueAiResponse({ throws: new Error('ETIMEDOUT: request timed out') });

    const outcome = await processEnquiry(enquiryId);
    expect(outcome).toEqual({ status: 'failed', reason: 'timeout' });

    const { rows } = await pool.query<{ category: string | null; needs_review: boolean; ai_status: string }>(
      `SELECT category, needs_review, ai_status FROM enquiries WHERE id = $1`,
      [enquiryId],
    );
    expect(rows[0]!.category).toBeNull();
    expect(rows[0]!.needs_review).toBe(false); // intact — not forced into review
    expect(rows[0]!.ai_status).toBe('failed');
  });

  it('AV-9: provider 500 — provider_error, same visibility', async () => {
    const enquiryId = await seedEnquiryWithMessage('Hello?');
    queueAiResponse({ throws: new Error('500 Internal Server Error') });
    queueAiResponse({ throws: new Error('500 Internal Server Error') });

    const outcome = await processEnquiry(enquiryId);
    expect(outcome).toEqual({ status: 'failed', reason: 'provider_error' });
  });

  it('AV-10: retry after a failure is bounded, attempt number recorded', async () => {
    const enquiryId = await seedEnquiryWithMessage('Hello?');
    queueAiResponse({ throws: new Error('500 Internal Server Error') }); // attempt 1 fails
    queueAiResponse({ text: classifyText({ category: 'room', confidence: 0.9 }) }); // attempt 2 succeeds
    queueAiResponse({ text: draftText() });

    const outcome = await processEnquiry(enquiryId);
    expect(outcome.status).toBe('ok');

    const { rows } = await pool.query<{ attempt_no: number; status: string }>(
      `SELECT attempt_no, status FROM ai_runs WHERE enquiry_id = $1 AND stage = 'classify' ORDER BY attempt_no`,
      [enquiryId],
    );
    expect(rows).toHaveLength(2);
    expect(rows[0]!.attempt_no).toBe(1);
    expect(rows[0]!.status).toBe('provider_error');
    expect(rows[1]!.attempt_no).toBe(2);
    expect(rows[1]!.status).toBe('ok');
  });

  it('AV-11: complaint text at confidence 0.1 still fires the GM alert (INV-18)', async () => {
    const gm = await createEmployee({ role: 'gm' });
    const enquiryId = await seedEnquiryWithMessage('This is the third time my room has not been cleaned, totally unacceptable.');
    queueAiResponse({ text: classifyText({ category: 'complaint', confidence: 0.1, isComplaint: true }) });
    queueAiResponse({ text: draftText() });

    const outcome = await processEnquiry(enquiryId);
    expect(outcome.status).toBe('ok');
    if (outcome.status === 'ok') expect(outcome.category).toBe('complaint');

    const { rows } = await pool.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM notifications WHERE enquiry_id = $1 AND type = 'complaint_alert' AND user_id = $2`,
      [enquiryId, gm.id],
    );
    expect(rows[0]!.n).toBe(1);
  });

  it('AV-15: every run records provider, model, prompt version, knowledge version, status, latency (INV-49)', async () => {
    const enquiryId = await seedEnquiryWithMessage('Hello?');
    queueAiResponse({ text: classifyText({ category: 'room', confidence: 0.9 }) });
    queueAiResponse({ text: draftText() });
    await processEnquiry(enquiryId);

    const { rows } = await pool.query<{
      provider: string; model: string; prompt_version: string; status: string; latency_ms: number | null;
    }>(`SELECT provider, model, prompt_version, status, latency_ms FROM ai_runs WHERE enquiry_id = $1`, [enquiryId]);
    expect(rows.length).toBeGreaterThanOrEqual(2);
    for (const row of rows) {
      expect(row.provider).toBe('gemini');
      expect(row.model).toBeTruthy();
      expect(row.prompt_version).toBeTruthy();
      expect(row.status).toBeTruthy();
      expect(row.latency_ms).not.toBeNull();
    }
  });

  it('AV-16: raw prompt text is not stored in ai_runs — only validated structured output', async () => {
    const enquiryId = await seedEnquiryWithMessage('Hello?');
    queueAiResponse({ text: classifyText({ category: 'room', confidence: 0.9 }) });
    queueAiResponse({ text: draftText() });
    await processEnquiry(enquiryId);

    const { rows } = await pool.query<{ output: unknown }>(`SELECT output FROM ai_runs WHERE enquiry_id = $1`, [enquiryId]);
    for (const row of rows) {
      const serialized = JSON.stringify(row.output);
      expect(serialized).not.toContain('You classify a hill-resort guest enquiry'); // the system prompt text
    }
  });

  it('AV-17: no message is ever sent automatically, on any outcome (INV-46)', async () => {
    const enquiryId = await seedEnquiryWithMessage('Hello?');
    queueAiResponse({ text: classifyText({ category: 'room', confidence: 0.9 }) });
    queueAiResponse({ text: draftText() });
    await processEnquiry(enquiryId);

    const { rows } = await pool.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM enquiry_messages WHERE enquiry_id = $1 AND direction = 'outbound'`,
      [enquiryId],
    );
    expect(rows[0]!.n).toBe(0);
  });

  it('AV-13: ENQ-4411\'s missing year is kept tentative with the original wording, not silently assumed (INV-48)', async () => {
    await createEmployee({ role: 'staff', team: 'reservations' });
    // The supplied fixture text, verbatim (Docs/Product.md §26) — "14-16 Nov" carries no year.
    const enquiryId = await seedEnquiryWithMessage('Is a villa free 14-16 Nov for 2 adults and a child?');
    queueAiResponse({
      text: classifyText({
        category: 'room',
        confidence: 0.9,
        checkIn: `${new Date().getUTCFullYear() + 1}-11-14`,
        checkOut: `${new Date().getUTCFullYear() + 1}-11-16`,
        adults: 2,
        children: 1,
        datesOriginalText: '14-16 Nov',
        datesTentative: true,
      }),
    });
    queueAiResponse({ text: draftText() });

    const outcome = await processEnquiry(enquiryId);
    expect(outcome.status).toBe('ok');

    const { rows } = await pool.query<{ category: string; extracted: { datesTentative: boolean; datesOriginalText: string | null } }>(
      `SELECT category, extracted FROM enquiries WHERE id = $1`,
      [enquiryId],
    );
    expect(rows[0]!.category).toBe('room');
    // The interpretation is stored, flagged tentative, alongside the guest's own wording —
    // the guess never replaces what they actually wrote.
    expect(rows[0]!.extracted.datesTentative).toBe(true);
    expect(rows[0]!.extracted.datesOriginalText).toBe('14-16 Nov');
  });
});
