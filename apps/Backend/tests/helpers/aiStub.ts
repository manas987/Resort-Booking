/**
 * Stubs the provider at the `generateStructured` boundary (Docs/tests-phase2.md: "Provider
 * responses are stubbed at the generateStructured boundary — the parsing, validation and
 * routing under test are real"). Imported once; `bun:test`'s `mock.module` rewrites the
 * module's live binding, so every caller already holding a reference to it — `processing.ts`
 * included, however it was imported — picks up the stub from here on.
 *
 * Call order matters: `processEnquiry` calls the provider once for classify, then (only on a
 * non-review outcome) once more for draft. Queue responses in that order.
 */
import { mock } from 'bun:test';

type StubOk = { text: string; model?: string; latencyMs?: number; inputTokens?: number; outputTokens?: number };
type StubItem = StubOk | { throws: Error };

const queue: StubItem[] = [];
export const capturedCalls: Array<{ system: string; user: string }> = [];

export function queueAiResponse(item: StubItem): void {
  queue.push(item);
}

export function resetAiStub(): void {
  queue.length = 0;
  capturedCalls.length = 0;
}

const FALLBACK_CLASSIFY_TEXT = JSON.stringify({
  category: null,
  confidence: 0,
  isComplaint: false,
  extracted: {
    checkIn: null, checkOut: null, adults: null, children: null, guestCount: null,
    budgetPaise: null, datesOriginalText: null, datesTentative: false, notes: null,
  },
});

mock.module('../../src/adapters/ai/gemini.ts', () => ({
  generateStructured: mock(async (input: { system: string; user: string }) => {
    capturedCalls.push({ system: input.system, user: input.user });
    const next = queue.shift();
    if (!next) return { text: FALLBACK_CLASSIFY_TEXT, model: 'stub-model', latencyMs: 1 };
    if ('throws' in next) throw next.throws;
    return { model: 'stub-model', latencyMs: 1, ...next };
  }),
}));
