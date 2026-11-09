/**
 * The only module in `src/console/` that calls `fetch` against `/api/admin/*`.
 *
 * Modelled on `src/lib/api.ts` rather than sharing it, for the same reason the backend keeps
 * two route trees that share no HTTP code: a guest 401 and a staff 401 must never be able to
 * refresh each other's session. The two clients talk to different auth endpoints, hold
 * different tokens and are allowed to diverge. The shapes they parse — the
 * `{error:{code,message,details,requestId}}` envelope — are identical because the backend emits
 * one envelope for everything.
 *
 * The access token lives in a module variable, never in storage (apps/Frontend/CLAUDE.md:
 * "Nothing sensitive in localStorage — no tokens"). The refresh credential is an httpOnly
 * cookie the browser owns; this module never sees it.
 */
import type { ErrorCode } from '../lib/types';

export type StaffPrincipal = {
  userId: string;
  kind: 'employee';
  role: 'staff' | 'gm' | 'owner';
  team: 'reservations' | 'sales' | null;
};

export class AdminApiError extends Error {
  readonly code: ErrorCode | string;
  readonly status: number;
  readonly details: unknown;
  readonly requestId: string | undefined;
  constructor(code: ErrorCode | string, message: string, status: number, details?: unknown, requestId?: string) {
    super(message);
    this.name = 'AdminApiError';
    this.code = code;
    this.status = status;
    this.details = details;
    this.requestId = requestId;
  }
}

let accessToken: string | null = null;
let principal: StaffPrincipal | null = null;
const listeners = new Set<() => void>();

function notify() {
  for (const listener of listeners) listener();
}

export function getStaffPrincipal(): StaffPrincipal | null {
  return principal;
}

export function subscribeStaffSession(callback: () => void): () => void {
  listeners.add(callback);
  return () => listeners.delete(callback);
}

function setStaffSession(next: { accessToken: string; principal: StaffPrincipal } | null) {
  accessToken = next?.accessToken ?? null;
  principal = next?.principal ?? null;
  notify();
}

/** Single-flight refresh: several screens loading at once produce several 401s, and each one
 *  racing its own rotation of the refresh cookie would revoke the session (reuse of an
 *  already-rotated refresh token is treated as theft server-side). */
let refreshInFlight: Promise<boolean> | null = null;

async function refreshOnce(): Promise<boolean> {
  if (!refreshInFlight) {
    refreshInFlight = (async () => {
      try {
        const response = await fetch('/api/admin/auth/refresh', { method: 'POST', credentials: 'include' });
        if (!response.ok) return false;
        const body = (await response.json()) as { accessToken: string; principal: StaffPrincipal };
        setStaffSession(body);
        return true;
      } catch {
        return false;
      } finally {
        refreshInFlight = null;
      }
    })();
  }
  return refreshInFlight;
}

type RequestOptions = {
  method?: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';
  body?: unknown;
  signal?: AbortSignal;
};

function send(path: string, options: RequestOptions): Promise<Response> {
  const headers: Record<string, string> = {};
  if (options.body !== undefined) headers['content-type'] = 'application/json';
  if (accessToken) headers.authorization = `Bearer ${accessToken}`;
  return fetch(`/api/admin${path}`, {
    method: options.method ?? 'GET',
    headers,
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
    credentials: 'include',
    signal: options.signal,
  });
}

export async function adminFetch<T>(path: string, options: RequestOptions = {}): Promise<T> {
  let response = await send(path, options);

  if (response.status === 401 && path !== '/auth/refresh' && path !== '/auth/login') {
    const refreshed = await refreshOnce();
    if (refreshed) response = await send(path, options);
  }

  if (response.status === 204) return undefined as T;

  // A CSV export is not JSON. Hand the caller the text and let it decide.
  const contentType = response.headers.get('content-type') ?? '';
  if (response.ok && !contentType.includes('application/json')) {
    return (await response.text()) as T;
  }

  const body: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const envelope = body as { error?: { code?: string; message?: string; details?: unknown; requestId?: string } } | null;
    if (response.status === 401) setStaffSession(null);
    throw new AdminApiError(
      envelope?.error?.code ?? 'internal_error',
      envelope?.error?.message ?? 'Something went wrong.',
      response.status,
      envelope?.error?.details,
      envelope?.error?.requestId,
    );
  }
  return body as T;
}

export async function staffLogin(username: string, password: string): Promise<StaffPrincipal> {
  const body = await adminFetch<{ accessToken: string; principal: StaffPrincipal }>('/auth/login', {
    method: 'POST',
    body: { username, password },
  });
  setStaffSession(body);
  return body.principal;
}

/** Ends the session server-side as well as here — `POST /auth/logout` reads and revokes the
 *  httpOnly refresh cookie. Clearing only the local token would leave it live. */
export async function staffLogout(): Promise<void> {
  try {
    await adminFetch('/auth/logout', { method: 'POST' });
  } finally {
    setStaffSession(null);
  }
}

/** Called once when the console mounts: a valid refresh cookie means an already-signed-in
 *  employee should not be asked for a password again after a reload. */
export async function restoreStaffSession(): Promise<StaffPrincipal | null> {
  const ok = await refreshOnce();
  return ok ? principal : null;
}
