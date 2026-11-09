import type { NextFunction, Request, Response } from 'express';
import { AppError } from './errors.ts';

/**
 * Fixed-window counters held in this process.
 *
 * ponytail: single-instance only. Two API containers each get their own counters, so the
 * effective limit doubles. Acceptable here — the deployment is one instance, and the limits
 * that actually protect anything (OTP single-use, 5-attempt lock, idempotency keys, the
 * `FOR UPDATE` inventory recheck) all live in Postgres. If this ever runs multi-instance,
 * move the counter to a `rate_limits` table keyed the same way; the call sites do not change.
 *
 * Never keyed on a raw IP in a log line or an error message. The key is internal only.
 */
type Bucket = { count: number; resetAt: number };
const buckets = new Map<string, Bucket>();

/** Keeps the map from growing without bound on a long-running process. */
function sweep(now: number): void {
  if (buckets.size < 5_000) return;
  for (const [key, bucket] of buckets) if (bucket.resetAt <= now) buckets.delete(key);
}

export type RateLimitOptions = {
  /** Window length in seconds. */
  windowSeconds: number;
  /** Requests permitted per key per window. */
  max: number;
  /** Names the limiter so two limiters on one route cannot share a bucket. */
  name: string;
  /**
   * What is being limited. Default is the client IP. Pass a function to limit per account or
   * per OTP destination — 1D needs both (one bucket per destination AND one per IP).
   * Returning null skips the limiter for that request.
   */
  key?: (request: Request, response: Response) => string | null;
};

export function rateLimit(options: RateLimitOptions) {
  const { windowSeconds, max, name, key } = options;

  return function rateLimitMiddleware(
    request: Request,
    response: Response,
    next: NextFunction,
  ): void {
    const subject = key ? key(request, response) : (request.ip ?? 'unknown');
    if (subject === null) {
      next();
      return;
    }

    const now = Date.now();
    sweep(now);

    const bucketKey = `${name}:${subject}`;
    const existing = buckets.get(bucketKey);

    if (!existing || existing.resetAt <= now) {
      buckets.set(bucketKey, { count: 1, resetAt: now + windowSeconds * 1_000 });
      next();
      return;
    }

    existing.count += 1;
    if (existing.count > max) {
      const retryAfter = Math.max(1, Math.ceil((existing.resetAt - now) / 1_000));
      response.setHeader('Retry-After', String(retryAfter));
      next(new AppError('rate_limited', 'Too many requests. Please wait and try again.'));
      return;
    }

    next();
  };
}

/** Test-only. Lets a suite start from a clean window instead of waiting one out. */
export function resetRateLimits(): void {
  buckets.clear();
}
