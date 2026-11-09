/**
 * The guest tree's auth guards (Docs/02-permissions.md, Docs/04-contracts.md). Shares no code
 * with `adminAuth.ts` (2A) — even the bearer-parsing is duplicated on purpose, per the
 * share-nothing rule between route trees.
 */
import type { NextFunction, Request, Response } from 'express';
import { loadPrincipal, verifyAccessToken } from '../core/tokens.ts';
import { forbidden, unauthenticated } from './errors.ts';

function bearerToken(request: Request): string | null {
  const header = request.get('authorization');
  if (!header?.startsWith('Bearer ')) return null;
  return header.slice('Bearer '.length).trim() || null;
}

/** Verifies the token, then re-reads role/team/verification/active state from the database —
 *  never trusts what was true when the token was minted (INV-15). */
async function resolvePrincipal(request: Request) {
  const token = bearerToken(request);
  if (!token) return null;
  const fromToken = await verifyAccessToken(token);
  if (!fromToken) return null;
  return loadPrincipal(fromToken.userId);
}

export async function requireGuest(
  request: Request,
  response: Response,
  next: NextFunction,
): Promise<void> {
  const principal = await resolvePrincipal(request);
  if (!principal || principal.kind !== 'guest') {
    next(unauthenticated());
    return;
  }
  response.locals.principal = principal;
  next();
}

export async function requireVerifiedGuest(
  request: Request,
  response: Response,
  next: NextFunction,
): Promise<void> {
  const principal = await resolvePrincipal(request);
  if (!principal || principal.kind !== 'guest') {
    next(unauthenticated());
    return;
  }
  if (!principal.emailVerified || !principal.phoneVerified) {
    next(forbidden('Verify your email and phone before booking.'));
    return;
  }
  if (principal.onboardingComplete === false) {
    next(forbidden('Confirm your name to complete your account before booking.'));
    return;
  }
  response.locals.principal = principal;
  next();
}

/** Populates response.locals.principal when a valid guest token is present; passes through,
 *  unauthenticated, otherwise. Never throws — used by routes that price for signed-out
 *  visitors but must stamp the guest when there is one (`user/quotes`, `user/availability`,
 *  and `/otp/verify` for the verify_email/verify_phone purposes). */
export async function optionalGuest(
  request: Request,
  response: Response,
  next: NextFunction,
): Promise<void> {
  const principal = await resolvePrincipal(request);
  if (principal && principal.kind === 'guest') {
    response.locals.principal = principal;
  }
  next();
}
