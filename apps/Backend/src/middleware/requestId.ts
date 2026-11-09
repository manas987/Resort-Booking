import type { NextFunction, Request, Response } from 'express';
import { randomUUID } from 'node:crypto';

/**
 * Attaches a request id, echoes it, and logs the outcome. The same id appears in the error
 * envelope, so a user-reported failure can be found in the log without guessing.
 *
 * A client-supplied X-Request-Id is accepted only if it looks safe, so it cannot be used to
 * inject newlines or arbitrary length into log lines.
 *
 * The log line carries the path WITHOUT its query string: the Google OAuth callback arrives as
 * `?code=<authorization code>`, which is a credential, and INV-53 says a credential never
 * reaches a log. Query parameters that matter for debugging are filters, and those are
 * reproducible from the request id plus the route.
 */
const SAFE_ID = /^[A-Za-z0-9_-]{8,64}$/;

export function requestId(req: Request, res: Response, next: NextFunction): void {
  const supplied = req.get('x-request-id');
  const id = supplied && SAFE_ID.test(supplied) ? supplied : randomUUID();

  res.locals.requestId = id;
  res.setHeader('X-Request-Id', id);

  const startedAt = performance.now();
  res.on('finish', () => {
    const ms = Math.round(performance.now() - startedAt);
    console.log(`[${id}] ${req.method} ${req.path} ${res.statusCode} ${ms}ms`);
  });

  next();
}
