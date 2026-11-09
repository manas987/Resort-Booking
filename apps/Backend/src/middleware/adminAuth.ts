/**
 * The admin tree's auth guards (Docs/02-permissions.md, Docs/04-contracts.md). Shares no code
 * with `userAuth.ts` (1D) — even the bearer-parsing is duplicated on purpose, per the
 * share-nothing rule between route trees.
 *
 * 401 vs 403: a missing, malformed, expired or badly-signed token is 401 `unauthenticated` —
 * there is no identity to evaluate. A *structurally valid* token that fails the guard (wrong
 * kind, wrong role/team, or an employee disabled after the token was minted) is 403
 * `forbidden` — the request was authenticated, just not permitted (DE-3, SP-25).
 */
import type { NextFunction, Request, Response } from 'express';
import { loadPrincipal, verifyAccessToken } from '../core/tokens.ts';
import type { Principal } from '../core/tokens.ts';
import { forbidden, unauthenticated } from './errors.ts';

function bearerToken(request: Request): string | null {
  const header = request.get('authorization');
  if (!header?.startsWith('Bearer ')) return null;
  return header.slice('Bearer '.length).trim() || null;
}

/** Verifies the token itself. Returns null only when there is no valid token at all. */
async function resolveTokenSubject(request: Request): Promise<string | null> {
  const token = bearerToken(request);
  if (!token) return null;
  const fromToken = await verifyAccessToken(token);
  return fromToken?.userId ?? null;
}

/** Re-reads role/team/active state from the database on every request — never trusts what
 *  was true when the token was minted (INV-15). Null means the token was valid but the
 *  account no longer resolves to a usable employee (disabled, deleted, or never an employee). */
async function loadEmployeePrincipal(userId: string): Promise<Principal | null> {
  const principal = await loadPrincipal(userId);
  if (!principal || principal.kind !== 'employee') return null;
  return principal;
}

export async function requireEmployee(
  request: Request,
  response: Response,
  next: NextFunction,
): Promise<void> {
  const userId = await resolveTokenSubject(request);
  if (!userId) return next(unauthenticated());
  const principal = await loadEmployeePrincipal(userId);
  if (!principal) return next(forbidden());
  response.locals.principal = principal;
  next();
}

export async function requireGm(
  request: Request,
  response: Response,
  next: NextFunction,
): Promise<void> {
  const userId = await resolveTokenSubject(request);
  if (!userId) return next(unauthenticated());
  const principal = await loadEmployeePrincipal(userId);
  if (!principal || (principal.role !== 'gm' && principal.role !== 'owner')) return next(forbidden());
  response.locals.principal = principal;
  next();
}

export async function requireOwner(
  request: Request,
  response: Response,
  next: NextFunction,
): Promise<void> {
  const userId = await resolveTokenSubject(request);
  if (!userId) return next(unauthenticated());
  const principal = await loadEmployeePrincipal(userId);
  if (!principal || principal.role !== 'owner') return next(forbidden());
  response.locals.principal = principal;
  next();
}

/** Reservations staff, gm or owner — never sales (INV-37). */
export async function requireExporter(
  request: Request,
  response: Response,
  next: NextFunction,
): Promise<void> {
  const userId = await resolveTokenSubject(request);
  if (!userId) return next(unauthenticated());
  const principal = await loadEmployeePrincipal(userId);
  const passes =
    principal && (principal.role === 'gm' || principal.role === 'owner' || (principal.role === 'staff' && principal.team === 'reservations'));
  if (!principal || !passes) return next(forbidden());
  response.locals.principal = principal;
  next();
}
