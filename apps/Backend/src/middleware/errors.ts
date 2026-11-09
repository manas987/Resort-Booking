import type { NextFunction, Request, Response } from 'express';
import type { ZodError } from 'zod';
import { isProduction } from '../env.ts';

/** Stable error codes. The UI may branch on these; see Docs/00-conventions.md. */
export type ErrorCode =
  | 'validation_failed'
  | 'malformed_json'
  | 'payload_too_large'
  | 'unsupported_media_type'
  | 'unauthenticated'
  | 'forbidden'
  | 'not_found'
  | 'availability_conflict'
  | 'promo_exhausted'
  | 'idempotency_key_reused'
  | 'stale_write'
  | 'last_owner'
  | 'quote_expired'
  | 'hold_expired'
  | 'price_changed'
  | 'rate_limited'
  | 'quote_already_booked'
  | 'feature_unavailable'
  | 'internal_error';

const STATUS: Record<ErrorCode, number> = {
  validation_failed: 400,
  malformed_json: 400,
  payload_too_large: 413,
  unsupported_media_type: 415,
  unauthenticated: 401,
  forbidden: 403,
  not_found: 404,
  availability_conflict: 409,
  promo_exhausted: 409,
  idempotency_key_reused: 409,
  stale_write: 409,
  last_owner: 409,
  quote_already_booked: 409,
  quote_expired: 410,
  hold_expired: 410,
  price_changed: 422,
  rate_limited: 429,
  feature_unavailable: 503,
  internal_error: 500,
};

/** An error that is safe to show a user. Anything else becomes a generic 500. */
export class AppError extends Error {
  readonly code: ErrorCode;
  readonly status: number;
  readonly details?: unknown;

  constructor(code: ErrorCode, message: string, details?: unknown) {
    super(message);
    this.name = 'AppError';
    this.code = code;
    this.status = STATUS[code];
    this.details = details;
  }
}

export const notFound = (what = 'Resource') => new AppError('not_found', `${what} not found.`);
export const forbidden = (message = 'You do not have access to this resource.') =>
  new AppError('forbidden', message);
export const unauthenticated = (message = 'Sign in to continue.') =>
  new AppError('unauthenticated', message);

/** Turns a Zod failure into the standard 400. The ONLY place a ZodError becomes a response,
 *  so `details.issues` has one shape everywhere (Docs/04-contracts.md). */
export function badRequest(error: ZodError): AppError {
  return new AppError('validation_failed', 'The request did not pass validation.', {
    issues: error.issues.map((issue) => ({ path: issue.path.join('.'), message: issue.message })),
  });
}

/** 404 handler for unmatched routes. Mounted after all routers. */
export function notFoundHandler(_req: Request, _res: Response, next: NextFunction): void {
  next(notFound('Endpoint'));
}

/**
 * The single error responder. Every non-2xx response leaves through here so the envelope is
 * identical everywhere. Unknown errors are logged with the requestId and reported generically
 * — never a stack trace, SQL fragment or driver message to the client.
 */
/**
 * `express.json()` rejects a bad body by throwing before any route runs. Those errors carry a
 * `type` and an HTTP `status`, and are the client's fault — translate them rather than letting
 * them fall through as a 500. Mapped here, once, so every route is covered.
 */
const BODY_PARSER_CODES: Record<string, ErrorCode> = {
  'entity.too.large': 'payload_too_large',
  'entity.parse.failed': 'malformed_json',
  'charset.unsupported': 'unsupported_media_type',
  'encoding.unsupported': 'unsupported_media_type',
  'entity.verify.failed': 'validation_failed',
};

const BODY_PARSER_MESSAGES: Partial<Record<ErrorCode, string>> = {
  payload_too_large: 'Request body is too large.',
  malformed_json: 'Request body is not valid JSON.',
  unsupported_media_type: 'Unsupported content type or encoding.',
};

function asAppError(err: unknown): AppError | null {
  if (err instanceof AppError) return err;
  const type = (err as { type?: unknown } | null)?.type;
  if (typeof type !== 'string') return null;
  const code = BODY_PARSER_CODES[type];
  if (!code) return null;
  return new AppError(code, BODY_PARSER_MESSAGES[code] ?? 'Request could not be read.');
}

export function errorHandler(
  err: unknown,
  req: Request,
  res: Response,
  _next: NextFunction,
): void {
  const requestId = res.locals.requestId as string | undefined;
  const appErr = asAppError(err);

  if (appErr) {
    if (appErr.status >= 500) console.error(`[${requestId}] ${appErr.code}: ${appErr.message}`);
    res.status(appErr.status).json({
      error: {
        code: appErr.code,
        message: appErr.message,
        details: appErr.details,
        requestId,
      },
    });
    return;
  }

  const message = err instanceof Error ? err.message : String(err);
  console.error(`[${requestId}] unhandled ${req.method} ${req.path}: ${message}`);
  if (!isProduction && err instanceof Error && err.stack) console.error(err.stack);

  res.status(500).json({
    error: {
      code: 'internal_error' satisfies ErrorCode,
      message: 'Something went wrong on our side. Please try again.',
      requestId,
    },
  });
}
