import { useCallback, useEffect, useState } from 'react';
import { ApiError } from './api';

export type Resource<T> = {
  data: T | null;
  error: ApiError | Error | null;
  loading: boolean;
  /** Re-runs the fetcher with the same deps. Every "Try again" in the app routes through here:
   *  the alternative that shipped was a plain `<a href>` back to the page you were already on,
   *  which is a full document reload and therefore throws away the in-memory session and cart
   *  (the exact failure Docs/13-frontend-structure.md warns about). A wouter `<Link>` to the
   *  current path would have been worse — it is a no-op, so the button would be dead. */
  refetch: () => void;
};

/** The minimum fetch-on-deps hook: aborts the in-flight request when deps change or the
 * component unmounts (Docs/Product.md §18 "cancel/ignore obsolete read requests"), and guards
 * against a slow earlier response clobbering a newer one. Deliberately not react-query — a
 * dependency for what this function does is the wrong trade (ponytail ladder, rung 6). */
export function useResource<T>(
  fetcher: (signal: AbortSignal) => Promise<T>,
  deps: readonly unknown[],
): Resource<T> {
  const [state, setState] = useState<Resource<T>>({ data: null, error: null, loading: true, refetch: () => {} });
  const [attempt, setAttempt] = useState(0);
  const refetch = useCallback(() => setAttempt((n) => n + 1), []);

  useEffect(() => {
    const controller = new AbortController();
    let stale = false;
    // Deferred a tick so this isn't a synchronous setState in the effect body (react-hooks
    // set-state-in-effect) — still runs before the fetch can possibly resolve.
    Promise.resolve().then(() => {
      if (!stale) setState((previous) => ({ ...previous, loading: true, error: null }));
    });
    fetcher(controller.signal)
      .then((data) => {
        if (!stale) setState({ data, error: null, loading: false, refetch });
      })
      .catch((error: unknown) => {
        if (stale || controller.signal.aborted) return;
        setState({
          data: null,
          error: error instanceof Error ? error : new Error(String(error)),
          loading: false,
          refetch,
        });
      });
    return () => {
      stale = true;
      controller.abort();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- deps is the caller's explicit key; `attempt` is what refetch() bumps
  }, [...deps, attempt]);

  return { ...state, refetch };
}
