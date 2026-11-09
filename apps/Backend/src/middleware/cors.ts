import type { NextFunction, Request, Response } from 'express';
import { env } from '../env.ts';

/**
 * Exact-origin allowlist. Not `*`: these routes carry credentials, and a wildcard origin with
 * credentials is both refused by browsers and wrong in principle.
 *
 * APP_ORIGIN is the only allowed browser origin. Localhost is added outside production so a
 * developer running Vite on another port is not blocked.
 */
const allowed = new Set(
  [
    env.APP_ORIGIN,
    env.NODE_ENV === 'production' ? null : 'http://localhost:5173',
    env.NODE_ENV === 'production' ? null : 'http://127.0.0.1:5173',
  ].filter((o): o is string => Boolean(o)),
);

export function cors(request: Request, response: Response, next: NextFunction): void {
  const origin = request.get('origin');

  if (origin && allowed.has(origin)) {
    response.setHeader('Access-Control-Allow-Origin', origin);
    response.setHeader('Access-Control-Allow-Credentials', 'true');
    response.setHeader('Vary', 'Origin');
    response.setHeader('Access-Control-Allow-Methods', 'GET,POST,PATCH,PUT,DELETE,OPTIONS');
    response.setHeader(
      'Access-Control-Allow-Headers',
      'Content-Type,Authorization,Idempotency-Key,X-Request-Id',
    );
    response.setHeader('Access-Control-Max-Age', '600');
  }

  // A preflight is answered whether or not the origin matched. An unmatched origin simply
  // carries no allow headers, so the browser blocks it — that is the control.
  if (request.method === 'OPTIONS') {
    response.status(204).end();
    return;
  }

  next();
}
