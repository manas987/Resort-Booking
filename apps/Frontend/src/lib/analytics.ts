// POST /analytics/events — fire-and-forget, server-deduplicated on `dedupeKey` (DO NOTHING on
// conflict), so a retry or a double-call is always free. anonId/sessionId are random and
// client-generated — never derived from IP/UA — and are non-sensitive, so sessionStorage is
// fine for them (Frontend/CLAUDE.md: "Non-sensitive search/selection state is fine").
const SESSION_KEY = 'qe_session_id';
const ANON_KEY = 'qe_anon_id';

function randomId(): string {
  return crypto.randomUUID();
}

function readOrCreate(storage: Storage, key: string): string {
  try {
    const existing = storage.getItem(key);
    if (existing) return existing;
    const created = randomId();
    storage.setItem(key, created);
    return created;
  } catch {
    return randomId(); // storage unavailable (private mode) — still usable for this one event
  }
}

function anonId(): string {
  return readOrCreate(localStorage, ANON_KEY);
}

function sessionId(): string {
  return readOrCreate(sessionStorage, SESSION_KEY);
}

export type AnalyticsEventType = 'visit' | 'search' | 'checkout_started' | 'booking_confirmed' | 'enquiry_submitted';

export function trackEvent(type: AnalyticsEventType, dedupeKey?: string, payload?: Record<string, unknown>): void {
  fetch('/api/user/analytics/events', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ anonId: anonId(), sessionId: sessionId(), type, dedupeKey, payload }),
  }).catch(() => {
    // best-effort — a dropped analytics beacon must never block or alarm the guest
  });
}
