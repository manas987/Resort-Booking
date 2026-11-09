// Every money/inventory POST needs an Idempotency-Key (Docs/14-frontend-api-map.md). A
// refresh or a silent-token-refresh retry must resend the SAME key with the BYTE-IDENTICAL
// body — the server replays on an exact match and 409s on a different body with the same key
// (Docs/00-conventions.md "Idempotency"). So the key and the body it was minted for travel
// together, in sessionStorage, keyed by a name the caller picks per request site.
export function idempotentRequest<T>(storageKey: string, body: T): { key: string; body: T } {
  try {
    const raw = sessionStorage.getItem(storageKey);
    if (raw) {
      const stored = JSON.parse(raw) as { key: string; body: T };
      if (JSON.stringify(stored.body) === JSON.stringify(body)) return stored;
    }
  } catch {
    // sessionStorage unavailable (private mode) — fall through to a fresh key every time
  }
  const fresh = { key: crypto.randomUUID(), body };
  try {
    sessionStorage.setItem(storageKey, JSON.stringify(fresh));
  } catch {
    // best-effort persistence only
  }
  return fresh;
}

export function clearIdempotentRequest(storageKey: string): void {
  try {
    sessionStorage.removeItem(storageKey);
  } catch {
    // nothing to do if storage is unavailable
  }
}
