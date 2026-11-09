import type { Principal } from '../core/tokens.ts';

/**
 * The ONLY place a request carries trusted state. Middleware writes it; controllers read it.
 *
 * Controllers never read identity from the body, the query or a header — see INV-7 and INV-35.
 * `request.user` does not exist in this project on purpose: one location, one spelling.
 */
declare global {
  namespace Express {
    interface Locals {
      /** Set by middleware/requestId for every request, including failures. */
      requestId: string;
      /** Set by middleware/userAuth or middleware/adminAuth. Absent on public routes. */
      principal?: Principal;
      /** Set by middleware/idempotency when the route requires an Idempotency-Key. */
      idempotencyKey?: string;
    }
  }
}
