import type { DateRange } from "react-day-picker";

/**
 * Decides what a click in the range calendar means.
 *
 * Split out of `DateRangeField` so it can be tested without a DOM — this is the
 * logic that broke twice, and the component itself is untestable here (the repo
 * has no jsdom/testing-library harness).
 *
 * `pending` is a check-in with no check-out yet. Keeping that state is the whole
 * point: feeding react-day-picker a *complete* range on every click made it take
 * `addToRange`'s complete-range path, which silently rewrote the start date.
 */
export interface SelectionResult {
  /** The new in-progress check-in, or null when there isn't one. */
  pending: Date | null;
  /** A finished range to hand to the parent, or null to commit nothing yet. */
  commit: { from: Date; to: Date } | null;
}

export function isSameDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate()
  );
}

export function nextSelection(pending: Date | null, next: DateRange | undefined): SelectionResult {
  // react-day-picker clears the range when you click the one day it holds.
  if (!next?.from) return { pending: null, commit: null };

  // Only a start so far — hold it, commit nothing.
  if (!next.to) return { pending: next.from, commit: null };

  // Clicking *earlier* than the pending check-in: the library completes this
  // backwards as {clicked → pending}, but Airbnb treats it as a new check-in.
  // We follow Airbnb. Flip this branch if completing backwards feels better.
  if (pending && isSameDay(next.to, pending) && next.from < pending) {
    return { pending: next.from, commit: null };
  }

  return { pending: null, commit: { from: next.from, to: next.to } };
}

/** "12 hrs", "2d", "2d 4h" — the rental window's length, for a trigger badge. */
export function formatDuration(from: Date, to: Date): string {
  const hrs = Math.max(1, Math.round((to.getTime() - from.getTime()) / 3_600_000));
  if (hrs < 24) return `${hrs} hrs`;
  const days = Math.floor(hrs / 24);
  const rem = hrs % 24;
  return rem ? `${days}d ${rem}h` : `${days}d`;
}
