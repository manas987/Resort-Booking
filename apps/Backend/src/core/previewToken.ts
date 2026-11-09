/**
 * The one shared confirmation/concurrency mechanism for 2F's three range-edit features
 * (rates, inventory, blackouts) — INV-57. `POST /preview` snapshots the touched `room_day`
 * rows and returns this hash; the matching `PUT`/`DELETE` must present it, and recomputes it
 * **inside the transaction, after taking the locks** — recomputed before the lock, it proves
 * nothing (04-contracts.md). A mismatch is `409 stale_write`: a newer edit landed in between
 * and is never silently overwritten.
 */
import { createHash } from 'node:crypto';

export function previewToken(
  rows: Array<{ roomTypeId: string; stayDate: string; pricePaise: number | null; allotment: number | null; isBlackout: boolean }>,
): string {
  const sorted = [...rows].sort((a, b) => a.roomTypeId.localeCompare(b.roomTypeId) || a.stayDate.localeCompare(b.stayDate));
  return createHash('sha256').update(JSON.stringify(sorted)).digest('hex');
}
