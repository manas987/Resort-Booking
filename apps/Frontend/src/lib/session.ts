import { useSyncExternalStore } from 'react';
import type { Principal } from './types';

// Access token lives ONLY in memory — never localStorage/sessionStorage (Frontend/CLAUDE.md:
// "Nothing sensitive in localStorage — no tokens"). The refresh credential is an httpOnly
// cookie the browser handles entirely on its own; this module never sees it.
let accessToken: string | null = null;
let principal: Principal | null = null;
// True until the one-shot refresh-cookie bootstrap has answered. Between first paint and that
// answer the app does not yet know whether anyone is signed in, and rendering the signed-out
// branch in the meantime is rendering the wrong thing, not an unknown one.
let restoring = true;
const listeners = new Set<() => void>();

function notify() {
  for (const fn of listeners) fn();
}

export function getAccessToken(): string | null {
  return accessToken;
}

export function getPrincipal(): Principal | null {
  return principal;
}

export function setSession(next: { accessToken: string; principal: Principal }): void {
  accessToken = next.accessToken;
  principal = next.principal;
  notify();
}

export function isRestoring(): boolean {
  return restoring;
}

/** Ends the restoring window, whatever the bootstrap concluded. Always called — a failed
 *  refresh is an answer ("nobody is signed in"), not a reason to wait for ever. */
export function finishRestoring(): void {
  if (!restoring) return;
  restoring = false;
  notify();
}

export function clearSession(): void {
  accessToken = null;
  principal = null;
  notify();
}

export function subscribeSession(callback: () => void): () => void {
  listeners.add(callback);
  return () => listeners.delete(callback);
}

/** The one way a component asks "who is signed in?". Replaces App.tsx's local `guest` string,
 *  which was set only by /signin's old demo flow and so disagreed with this module whenever a
 *  guest signed in at /checkout instead (and vice versa). */
export function usePrincipal(): Principal | null {
  return useSyncExternalStore(subscribeSession, getPrincipal, getPrincipal);
}

/** True while the refresh-cookie bootstrap is still in flight. A screen whose two branches are
 *  "signed in" and "signed out" needs this to avoid showing the second one to someone who turns
 *  out to be the first. */
export function useSessionRestoring(): boolean {
  return useSyncExternalStore(subscribeSession, isRestoring, isRestoring);
}

/** Ends the session on the SERVER as well as here. `POST /auth/logout` reads the httpOnly
 *  `resort_refresh` cookie and revokes it; without this call, "Sign out" cleared a local
 *  variable while the refresh cookie stayed valid and api.ts's silent retry would quietly
 *  resume the session. Returns false if the server call failed, so the caller can be honest
 *  rather than showing a signed-out UI over a live session. */
export async function signOut(): Promise<boolean> {
  const { apiFetch } = await import('./api');
  try {
    await apiFetch('/auth/logout', { method: 'POST' });
    return true;
  } catch {
    return false;
  } finally {
    clearSession();
  }
}
