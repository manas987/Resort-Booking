/**
 * The bounded AI pipeline (Docs/04-contracts.md). NEVER inside a transaction while the
 * provider call is in flight (INV-20) — every DB write around it is its own short-lived
 * statement or transaction. `generateStructured` is the only thing that touches the network
 * (AB-14); this file is the only caller of it.
 */
import { pool, withTransaction } from '../../db.ts';
import { POLICY } from '../policy.ts';
import { generateStructured } from '../../adapters/ai/gemini.ts';
import {
  CLASSIFY_PROMPT_VERSION,
  DRAFT_PROMPT_VERSION,
  CLASSIFY_SYSTEM_PROMPT,
  DRAFT_SYSTEM_PROMPT,
  buildClassifyUserPrompt,
  buildDraftUserPrompt,
} from '../../adapters/ai/prompts.ts';
import { classifyJsonSchema, classifyResponseSchema, draftJsonSchema, draftResponseSchema } from '../../adapters/ai/responseSchemas.ts';
import type { ClassifyResponse, DraftResponse } from '../../adapters/ai/responseSchemas.ts';
import { routeEnquiry, notifyComplaintAlert } from './assignment.ts';
import type { Category } from './assignment.ts';
import { calculateQuote } from '../pricing.ts';

export type { Category };

export type ProcessOutcome =
  | { status: 'ok'; category: Category; confidence: number; draftId: string }
  | { status: 'needs_review'; reason: 'low_confidence' | 'semantic_invalid' | 'schema_invalid' }
  | { status: 'failed'; reason: 'timeout' | 'provider_error' };

type AiRunStatus =
  | 'ok' | 'schema_invalid' | 'semantic_invalid' | 'low_confidence' | 'timeout' | 'provider_error' | 'price_claim_rejected';

function resortToday(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: POLICY.timezone }).format(new Date());
}

function isTimeoutError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /timeout|timed out|ETIMEDOUT|AbortError/i.test(message);
}

async function recordAiRun(input: {
  enquiryId: string;
  stage: 'classify' | 'draft';
  provider: string;
  model: string;
  promptVersion: string;
  knowledgeVersion: number | null;
  status: AiRunStatus;
  output: unknown;
  validationErrors: unknown;
  attemptNo: number;
  latencyMs: number | null;
  inputTokens?: number;
  outputTokens?: number;
}): Promise<string> {
  const { rows } = await pool.query<{ id: string }>(
    `INSERT INTO ai_runs
       (enquiry_id, stage, provider, model, prompt_version, knowledge_version, status, output,
        validation_errors, attempt_no, latency_ms, input_tokens, output_tokens)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
     RETURNING id`,
    [
      input.enquiryId,
      input.stage,
      input.provider,
      input.model,
      input.promptVersion,
      input.knowledgeVersion,
      input.status,
      input.output !== undefined ? JSON.stringify(input.output) : null,
      input.validationErrors !== undefined ? JSON.stringify(input.validationErrors) : null,
      input.attemptNo,
      input.latencyMs,
      input.inputTokens ?? null,
      input.outputTokens ?? null,
    ],
  );
  return rows[0]!.id;
}

/** Retries only a transient failure (timeout/provider error) — a schema- or
 *  semantically-invalid response is deterministic enough that retrying is pointless, and is
 *  never retried (AV-10's "bounded" applies to transient failures, recorded via attempt_no). */
async function callWithBoundedRetry(args: {
  enquiryId: string;
  stage: 'classify' | 'draft';
  promptVersion: string;
  system: string;
  user: string;
  responseSchema: Record<string, unknown>;
}): Promise<
  | { ok: true; text: string; model: string; latencyMs: number; inputTokens?: number; outputTokens?: number; attempt: number }
  | { ok: false; reason: 'timeout' | 'provider_error'; attempt: number }
> {
  let lastReason: 'timeout' | 'provider_error' = 'provider_error';
  for (let attempt = 1; attempt <= POLICY.ai.maxAttempts; attempt += 1) {
    try {
      const result = await generateStructured({
        promptVersion: args.promptVersion,
        system: args.system,
        user: args.user,
        responseSchema: args.responseSchema,
      });
      return { ok: true, ...result, attempt };
    } catch (error) {
      lastReason = isTimeoutError(error) ? 'timeout' : 'provider_error';
      await recordAiRun({
        enquiryId: args.enquiryId,
        stage: args.stage,
        provider: 'gemini',
        model: 'unknown',
        promptVersion: args.promptVersion,
        knowledgeVersion: null,
        status: lastReason,
        output: null,
        validationErrors: { error: error instanceof Error ? error.message : String(error) },
        attemptNo: attempt,
        latencyMs: null,
      });
    }
  }
  return { ok: false, reason: lastReason, attempt: POLICY.ai.maxAttempts };
}

async function loadApprovedResortInfo(): Promise<{ text: string; knowledgeVersion: number | null }> {
  const { rows } = await pool.query<{ key: string; title: string; body: string; version: number }>(
    `SELECT key, title, body, version FROM resort_info WHERE is_current ORDER BY key`,
  );
  if (rows.length === 0) return { text: 'No approved resort information is on file.', knowledgeVersion: null };
  const text = rows.map((r) => `${r.title}: ${r.body}`).join('\n');
  const knowledgeVersion = Math.max(...rows.map((r) => r.version));
  return { text, knowledgeVersion };
}

async function loadGuestVisibleThread(enquiryId: string): Promise<string[]> {
  const { rows } = await pool.query<{ direction: string; body: string }>(
    `SELECT direction, body FROM enquiry_messages
       WHERE enquiry_id = $1 AND visibility = 'guest' ORDER BY created_at`,
    [enquiryId],
  );
  return rows.map((r) => `${r.direction === 'inbound' ? 'Guest' : 'Staff'}: ${r.body}`);
}

/** The ONLY entity data besides the thread itself the model may see — and only when the
 *  backend itself verified the link (INV-21, INV-22). A booking reference typed into a
 *  message is a string, not authorisation; this never looks at message text to find one. */
async function renderLinkedBookingQuoteBlock(bookingId: string): Promise<string | null> {
  const { rows: bookingRows } = await pool.query<{ check_in: string; check_out: string }>(
    `SELECT check_in, check_out FROM bookings WHERE id = $1`,
    [bookingId],
  );
  const booking = bookingRows[0];
  if (!booking) return null;

  const { rows: roomRows } = await pool.query<{ room_type_id: string; room_name_snapshot: string; adults: number; children: number }>(
    `SELECT room_type_id, room_name_snapshot, adults, children FROM booking_rooms WHERE booking_id = $1`,
    [bookingId],
  );
  if (roomRows.length === 0) return null;

  // A fresh quote at today's rates — not the booking's own locked total — so staff can see
  // whether quoting this number now would be stale before they send it (AB-11).
  const quote = await calculateQuote(pool, {
    stay: { checkIn: booking.check_in, checkOut: booking.check_out },
    rooms: roomRows.map((r) => ({ roomTypeId: r.room_type_id, adults: r.adults, children: r.children })),
  });
  const rupees = (paise: number) => (paise / 100).toFixed(2);
  const roomNames = roomRows.map((r) => r.room_name_snapshot).join(', ');
  return `${roomNames}, ${booking.check_in} to ${booking.check_out}, total ₹${rupees(quote.totalPaise)} (incl. tax, at today's rates).`;
}

function validateClassifySemantics(parsed: ClassifyResponse): { ok: true } | { ok: false; reason: string } {
  const { extracted } = parsed;
  const today = resortToday();

  if (extracted.checkIn && extracted.checkOut) {
    if (Number.isNaN(Date.parse(extracted.checkIn)) || Number.isNaN(Date.parse(extracted.checkOut))) {
      return { ok: false, reason: 'checkIn/checkOut are not real calendar dates.' };
    }
    if (extracted.checkOut <= extracted.checkIn) {
      return { ok: false, reason: 'checkOut is not after checkIn.' };
    }
    // A tentative guess (missing year/day) is allowed to land in the past relative to today's
    // best-guess year — only a confident, fully-specified date is held to "not in the past".
    if (!extracted.datesTentative && extracted.checkIn < today) {
      return { ok: false, reason: 'checkIn is in the past.' };
    }
  }
  if (extracted.guestCount !== null && (extracted.guestCount < 1 || extracted.guestCount > POLICY.ai.maxPlausibleGuestCount)) {
    return { ok: false, reason: 'guestCount is outside a plausible range.' };
  }
  if (extracted.adults !== null && extracted.adults < 0) return { ok: false, reason: 'adults cannot be negative.' };
  if (extracted.children !== null && extracted.children < 0) return { ok: false, reason: 'children cannot be negative.' };
  if (extracted.budgetPaise !== null && extracted.budgetPaise < 0) return { ok: false, reason: 'budgetPaise cannot be negative.' };

  return { ok: true };
}

/** A rupee amount: the symbol, "Rs"/"INR", or a comma-grouped figure like 12,000. Deliberately
 *  narrow — it must NOT fire on a guest count ("250 guests"), a bare year, a date ("14-16 Nov"),
 *  a time ("2pm") or a room count, all of which appear in legitimate drafts. */
const MONETARY_CLAIM = /(?:₹\s*\d|\bRs\.?\s*\d|\bINR\b|\b\d{1,3}(?:,\d{2,3})+\b)/i;

/** Rejects a monetary claim in the draft that isn't backed by the rendered quote block (INV-45).
 *
 *  Two independent checks, because the first one trusts the model:
 *    1. `statesPrice`, which the model self-reports — a dishonest `false` would sail through.
 *    2. a text scan of the body, which does not. The model is instructed never to state a price
 *       outside the quote block, and in live probes it complied every time, but INV-45 should
 *       not rest on that. If no quote block was rendered, no rupee figure may appear at all. */
function validateDraft(draft: DraftResponse, quoteBlock: string | null): { ok: true } | { ok: false; reason: string } {
  if (quoteBlock) return { ok: true };
  if (draft.statesPrice) {
    return { ok: false, reason: 'Draft states a price with no backend quote block to support it.' };
  }
  if (MONETARY_CLAIM.test(draft.body)) {
    return { ok: false, reason: 'Draft body contains a monetary figure while reporting statesPrice=false, with no quote block to support it.' };
  }
  return { ok: true };
}

export async function processEnquiry(enquiryId: string): Promise<ProcessOutcome> {
  const { rows: enquiryRows } = await pool.query<{
    id: string;
    public_ref: string;
    booking_id: string | null;
  }>(`SELECT id, public_ref, booking_id FROM enquiries WHERE id = $1`, [enquiryId]);
  const enquiry = enquiryRows[0];
  if (!enquiry) throw new Error(`processEnquiry: enquiry ${enquiryId} not found.`);

  const thread = await loadGuestVisibleThread(enquiryId);
  const latestGuestMessage = thread.filter((line) => line.startsWith('Guest:')).pop() ?? thread.join('\n');

  // STAGE 1: classify + extract.
  const classifyCall = await callWithBoundedRetry({
    enquiryId,
    stage: 'classify',
    promptVersion: CLASSIFY_PROMPT_VERSION,
    system: CLASSIFY_SYSTEM_PROMPT,
    user: buildClassifyUserPrompt({ message: latestGuestMessage, today: resortToday() }),
    responseSchema: classifyJsonSchema,
  });
  if (!classifyCall.ok) {
    await markAiFailure(enquiryId, enquiry.public_ref);
    return { status: 'failed', reason: classifyCall.reason };
  }

  // STAGE 2: Zod parse.
  let parsedJson: unknown;
  try {
    parsedJson = JSON.parse(classifyCall.text);
  } catch {
    await recordAiRun({
      enquiryId, stage: 'classify', provider: 'gemini', model: classifyCall.model, promptVersion: CLASSIFY_PROMPT_VERSION,
      knowledgeVersion: null, status: 'schema_invalid', output: classifyCall.text,
      validationErrors: { error: 'Response was not valid JSON.' }, attemptNo: classifyCall.attempt, latencyMs: classifyCall.latencyMs,
      inputTokens: classifyCall.inputTokens, outputTokens: classifyCall.outputTokens,
    });
    await markInvalid(enquiryId, null);
    return { status: 'needs_review', reason: 'schema_invalid' };
  }
  const classifyParsed = classifyResponseSchema.safeParse(parsedJson);
  if (!classifyParsed.success) {
    await recordAiRun({
      enquiryId, stage: 'classify', provider: 'gemini', model: classifyCall.model, promptVersion: CLASSIFY_PROMPT_VERSION,
      knowledgeVersion: null, status: 'schema_invalid', output: parsedJson,
      validationErrors: classifyParsed.error.issues, attemptNo: classifyCall.attempt, latencyMs: classifyCall.latencyMs,
      inputTokens: classifyCall.inputTokens, outputTokens: classifyCall.outputTokens,
    });
    await markInvalid(enquiryId, null);
    return { status: 'needs_review', reason: 'schema_invalid' };
  }

  // STAGE 3: semantic validation.
  const semantic = validateClassifySemantics(classifyParsed.data);
  if (!semantic.ok) {
    await recordAiRun({
      enquiryId, stage: 'classify', provider: 'gemini', model: classifyCall.model, promptVersion: CLASSIFY_PROMPT_VERSION,
      knowledgeVersion: null, status: 'semantic_invalid', output: classifyParsed.data,
      validationErrors: { reason: semantic.reason }, attemptNo: classifyCall.attempt, latencyMs: classifyCall.latencyMs,
      inputTokens: classifyCall.inputTokens, outputTokens: classifyCall.outputTokens,
    });
    await markInvalid(enquiryId, null);
    return { status: 'needs_review', reason: 'semantic_invalid' };
  }

  const confident = classifyParsed.data.confidence >= POLICY.ai.minConfidence;
  // Two separate ways the classifier can fail to give us something routable, and both go to the
  // GM's Unsorted lane (Product.md §2 "low-confidence enquiries go to an unsorted lane the GM
  // sees"):
  //   - confidence below POLICY.ai.minConfidence, or
  //   - no category at all. The classify prompt explicitly invites this ("leave it null rather
  //     than invent one"), and the model reports its confidence in THAT judgement — so a null
  //     category at confidence 0.9 means "I am sure I cannot tell", not "this is fine".
  // Conflating the two is how a null category used to be stored ai_status='ok',
  // needs_review=false and counted nowhere in GET /admin/enquiries/counts.
  // Complaint routing never depends on either check (INV-18).
  const isComplaintCategory = classifyParsed.data.category === 'complaint';
  const routable = (confident && classifyParsed.data.category !== null) || isComplaintCategory;
  const category = routable ? classifyParsed.data.category : null;
  const needsReview = !routable;

  const aiRunId = await recordAiRun({
    enquiryId, stage: 'classify', provider: 'gemini', model: classifyCall.model, promptVersion: CLASSIFY_PROMPT_VERSION,
    knowledgeVersion: null, status: needsReview ? 'low_confidence' : 'ok', output: classifyParsed.data, validationErrors: null,
    attemptNo: classifyCall.attempt, latencyMs: classifyCall.latencyMs, inputTokens: classifyCall.inputTokens, outputTokens: classifyCall.outputTokens,
  });

  // STAGE 4: route.
  await withTransaction(async (client) => {
    const result = await routeEnquiry(client, { category, needsReview });
    await client.query(
      `UPDATE enquiries SET category = $1, is_complaint = $2, needs_review = $3,
              confidence = $4, extracted = $5, assignee_id = COALESCE(assignee_id, $6),
              ai_status = $7, last_activity_at = now()
         WHERE id = $8`,
      [
        category,
        classifyParsed.data.isComplaint,
        needsReview,
        classifyParsed.data.confidence,
        JSON.stringify(classifyParsed.data.extracted),
        result.assigneeId,
        needsReview ? 'low_confidence' : 'ok',
        enquiryId,
      ],
    );
    if (result.notifyGm) {
      await notifyComplaintAlert(client, { enquiryId, publicRef: enquiry.public_ref });
    }
    return result;
  });

  // `category === null` is implied by `needsReview` above — stated explicitly so the compiler
  // narrows `category` for Stage 5/6 instead of a cast asserting it (which is how the null case
  // slipped through before).
  if (needsReview || category === null) {
    return { status: 'needs_review', reason: 'low_confidence' };
  }

  // STAGE 5/6: assemble context and draft. `needsReview` is false here, so `routable` was true,
  // so `category` is a real Category — narrowed below rather than asserted with a cast.
  const [resortInfo, quoteBlock] = await Promise.all([
    loadApprovedResortInfo(),
    enquiry.booking_id ? renderLinkedBookingQuoteBlock(enquiry.booking_id) : Promise.resolve(null),
  ]);

  const draftCall = await callWithBoundedRetry({
    enquiryId,
    stage: 'draft',
    promptVersion: DRAFT_PROMPT_VERSION,
    system: DRAFT_SYSTEM_PROMPT,
    user: buildDraftUserPrompt({
      thread,
      resortInfo: resortInfo.text,
      quoteBlock,
      extractedNotes: classifyParsed.data.extracted.notes,
      today: resortToday(),
    }),
    responseSchema: draftJsonSchema,
  });
  if (!draftCall.ok) {
    await markAiFailure(enquiryId, enquiry.public_ref);
    return { status: 'failed', reason: draftCall.reason };
  }

  let draftJson: unknown;
  try {
    draftJson = JSON.parse(draftCall.text);
  } catch {
    await recordAiRun({
      enquiryId, stage: 'draft', provider: 'gemini', model: draftCall.model, promptVersion: DRAFT_PROMPT_VERSION,
      knowledgeVersion: resortInfo.knowledgeVersion, status: 'schema_invalid', output: draftCall.text,
      validationErrors: { error: 'Response was not valid JSON.' }, attemptNo: draftCall.attempt, latencyMs: draftCall.latencyMs,
      inputTokens: draftCall.inputTokens, outputTokens: draftCall.outputTokens,
    });
    return { status: 'needs_review', reason: 'schema_invalid' };
  }
  const draftParsed = draftResponseSchema.safeParse(draftJson);
  if (!draftParsed.success) {
    await recordAiRun({
      enquiryId, stage: 'draft', provider: 'gemini', model: draftCall.model, promptVersion: DRAFT_PROMPT_VERSION,
      knowledgeVersion: resortInfo.knowledgeVersion, status: 'schema_invalid', output: draftJson,
      validationErrors: draftParsed.error.issues, attemptNo: draftCall.attempt, latencyMs: draftCall.latencyMs,
      inputTokens: draftCall.inputTokens, outputTokens: draftCall.outputTokens,
    });
    return { status: 'needs_review', reason: 'schema_invalid' };
  }

  // STAGE 7: validate the draft's monetary claim.
  const draftValidation = validateDraft(draftParsed.data, quoteBlock);
  const draftStatus: AiRunStatus = draftValidation.ok ? 'ok' : 'price_claim_rejected';
  const draftAiRunId = await recordAiRun({
    enquiryId, stage: 'draft', provider: 'gemini', model: draftCall.model, promptVersion: DRAFT_PROMPT_VERSION,
    knowledgeVersion: resortInfo.knowledgeVersion, status: draftStatus, output: draftParsed.data,
    validationErrors: draftValidation.ok ? null : { reason: draftValidation.reason },
    attemptNo: draftCall.attempt, latencyMs: draftCall.latencyMs, inputTokens: draftCall.inputTokens, outputTokens: draftCall.outputTokens,
  });

  if (!draftValidation.ok) {
    return { status: 'needs_review', reason: 'semantic_invalid' };
  }

  const draftId = await withTransaction(async (client) => {
    // Supersedes any still-pending draft — the partial unique index allows only one pending
    // draft per enquiry at a time.
    await client.query(`UPDATE ai_drafts SET state = 'superseded', updated_at = now() WHERE enquiry_id = $1 AND state = 'pending'`, [
      enquiryId,
    ]);
    const { rows } = await client.query<{ id: string }>(
      `INSERT INTO ai_drafts (enquiry_id, ai_run_id, body, quote_block, state)
       VALUES ($1, $2, $3, $4, 'pending') RETURNING id`,
      [enquiryId, draftAiRunId, draftParsed.data.body, quoteBlock ? JSON.stringify({ text: quoteBlock }) : null],
    );
    return rows[0]!.id;
  });

  void aiRunId; // recorded for audit; not otherwise read here
  return { status: 'ok', category, confidence: classifyParsed.data.confidence, draftId };
}

/** Schema- or semantically-invalid output (classify stage): the enquiry goes to the Unsorted
 *  lane (`needs_review`), `ai_status = 'invalid'` — distinct from `'failed'`, which is the
 *  transient-error case below and leaves the enquiry otherwise untouched (INV-47). */
async function markInvalid(enquiryId: string, category: Category | null): Promise<void> {
  await withTransaction(async (client) => {
    const result = await routeEnquiry(client, { category, needsReview: true });
    await client.query(
      `UPDATE enquiries SET needs_review = true, ai_status = 'invalid', assignee_id = COALESCE(assignee_id, $1), last_activity_at = now()
         WHERE id = $2`,
      [result.assigneeId, enquiryId],
    );
  });
}

/** A timeout or provider error leaves the enquiry otherwise intact (no forced review, no
 *  reassignment) but visible — `ai_status = 'failed'` plus an `ai_failure` alert to every
 *  active GM/owner, so someone knows to retry (01-data-model.md's notification purposes). */
async function markAiFailure(enquiryId: string, publicRef: string): Promise<void> {
  await withTransaction(async (client) => {
    await client.query(`UPDATE enquiries SET ai_status = 'failed', last_activity_at = now() WHERE id = $1`, [enquiryId]);
    const { rows: recipients } = await client.query<{ id: string }>(
      `SELECT id FROM users WHERE kind = 'employee' AND role IN ('gm', 'owner') AND is_active`,
    );
    for (const recipient of recipients) {
      await client.query(
        `INSERT INTO notifications (user_id, type, enquiry_id, body) VALUES ($1, 'ai_failure', $2, $3)`,
        [recipient.id, enquiryId, `AI processing failed on ${publicRef}.`],
      );
    }
  });
}
