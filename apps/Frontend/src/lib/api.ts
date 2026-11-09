import type { ApiErrorBody, ErrorCode, Principal } from './types';
import { clearSession, getAccessToken, setSession } from './session';

export class ApiError extends Error {
  readonly code: ErrorCode;
  readonly status: number;
  readonly details: unknown;
  readonly requestId: string;
  constructor(status: number, body: ApiErrorBody) {
    super(body.error.message);
    this.code = body.error.code;
    this.status = status;
    this.details = body.error.details;
    this.requestId = body.error.requestId;
  }
}

/** True for the specific benign case Docs/14 calls out: a duplicate Idempotency-Key for a
 * request that is still being processed by an earlier, slower attempt. Callers should poll
 * and retry rather than surface this as a failure. */
export function isInFlightReplay(error: unknown): boolean {
  return error instanceof ApiError && error.code === 'idempotency_key_reused' && error.status === 409;
}

type RequestOptions = {
  method?: 'GET' | 'POST' | 'PATCH' | 'DELETE';
  body?: unknown;
  idempotencyKey?: string;
  signal?: AbortSignal;
};

async function parseErrorBody(response: Response): Promise<ApiErrorBody> {
  try {
    const parsed = (await response.json()) as ApiErrorBody;
    if (parsed?.error?.code) return parsed;
  } catch {
    // fall through to the generic envelope below
  }
  return { error: { code: 'internal_error', message: 'Something went wrong.', requestId: '' } };
}

// Single-flight refresh: concurrent 401s from parallel requests share one call to
// POST /auth/refresh rather than each racing their own rotation of the refresh cookie.
let refreshInFlight: Promise<boolean> | null = null;

async function refreshOnce(): Promise<boolean> {
  if (!refreshInFlight) {
    refreshInFlight = (async () => {
      try {
        const response = await fetch('/api/user/auth/refresh', { method: 'POST', credentials: 'include' });
        if (!response.ok) return false;
        const data = (await response.json()) as { accessToken: string; principal: Principal };
        setSession(data);
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

async function send(path: string, options: RequestOptions): Promise<Response> {
  const headers: Record<string, string> = {};
  if (options.body !== undefined) headers['Content-Type'] = 'application/json';
  if (options.idempotencyKey) headers['Idempotency-Key'] = options.idempotencyKey;
  const token = getAccessToken();
  if (token) headers.Authorization = `Bearer ${token}`;
  return fetch(`/api/user${path}`, {
    method: options.method ?? 'GET',
    headers,
    body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
    credentials: 'include', // carries the httpOnly resort_refresh cookie
    signal: options.signal,
  });
}

/** The one place that talks HTTP to the guest API. Retries exactly once after a silent
 * refresh on 401; any other status (or a second 401) is thrown as an ApiError. */
export async function apiFetch<T>(path: string, options: RequestOptions = {}): Promise<T> {
  let response = await send(path, options);
  if (response.status === 401 && path !== '/auth/refresh') {
    const refreshed = await refreshOnce();
    if (refreshed) response = await send(path, options);
    if (response.status === 401) clearSession();
  }
  if (!response.ok) throw new ApiError(response.status, await parseErrorBody(response));
  if (response.status === 204) return undefined as T;
  return (await response.json()) as T;
}
