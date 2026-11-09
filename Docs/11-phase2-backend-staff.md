# Phase 2 — Backend, staff / GM / owner surface

Eight sub-phases. **Do one at a time, in order.** Phase 1 must be green first. Do not start a
sub-phase before its tests in `tests-phase2.md` are written.

Read with: `04-contracts.md`, `05-invariants.md`, `06-touch-map.md`, `02-permissions.md`.

Mounted at `/api/admin/*`. Guard middleware is `requireEmployee`,
`requireGm`, `requireOwner`, `requireExporter` — exact names and exports in `04-contracts.md`,
who-passes in `02-permissions.md`. `assignedOrAbove` is **not** middleware: it needs the row,
so it is a named check in the controller after the enquiry is loaded.

## Goals

1. Employees sign in with issued credentials or linked Google; disabling closes every door at
   once, live sessions included.
2. Every permission is enforced server-side and proved by a negative test.
3. Enquiries from all three sources normalise into one inbox with correct routing.
4. Real Gemini classification, extraction and drafting, with every failure mode landing
   somewhere a human sees it.
5. A draft never becomes a sent message without an explicit human action.
6. GM rate, allotment and blackout edits cannot break the inventory invariant or rewrite a
   sold booking.
7. Owner metrics and audit are honestly defined and honestly labelled.

---

## 2A — Employee auth and accounts

**Files.** `routes/admin/auth/*`, `middleware/adminAuth.ts`, `routes/admin/staff/*`.

| Method | Path | Guard |
|---|---|---|
| POST | `/auth/login` | public, hard rate limit per account and per IP |
| POST | `/auth/google` | public — Google linked to an **already-approved** employee |
| POST | `/auth/refresh` · `/auth/logout` | public / employee |
| GET | `/auth/me` | employee — role, team, permissions for nav |
| GET · POST | `/staff` | `requireGm` |
| PATCH | `/staff/:targetUserId` | `requireGm` |
| POST | `/staff/:targetUserId/disable` · `/enable` | `requireGm` |

`middleware/adminAuth` re-reads `is_active` from the database **every request** — never trusts
the token (INV-15). Disable: revoke all sessions, block every login path, stop auto-assignment,
`reassignOnEmployeeDisable` (INV-17). Refuse on the last active owner. GM → staff only; owner →
GM or staff; **no route creates or promotes an owner** (INV-36).

Login failures are generic — never reveal whether a username exists. Only the hash is stored;
the password never reaches a log or an audit row.

**Exit.** `access.staffPermissions`, `access.disabledEmployee` pass. A disabled employee with a
live access token is rejected on their next request. A GM calling owner-only routes gets `403`.

**Do not.** Reuse `middleware/userAuth`. Let a token's cached role decide anything. Log a
password. Delete an employee row.

---

## 2B — Inbox reads

**Files.** `routes/admin/enquiries/*` (list, counts, detail, read),
`routes/admin/notifications/*`.

| Method | Path | Guard |
|---|---|---|
| GET | `/enquiries` | employee — filters: status, category, source, assignee, complaint, needs-review, unassigned, search. Sorts from an allowlist. Paginated **summary rows only** |
| GET | `/enquiries/counts` | employee — per-status lane counts plus unsorted/unassigned/complaint/unread facets. The Kanban header source and the cheap poll target |
| GET | `/enquiries/:enquiryId` | `assignedOrAbove` — guest messages, internal notes, extraction, assignment history, delivery states, pending draft. Paginated history |
| POST | `/enquiries/:enquiryId/read` | `assignedOrAbove` |
| GET | `/notifications` · `POST /notifications/:id/read` | employee |

Staff see their assigned threads; GM and owner see everything (INV-38).

**Exit.** `enquiry.inbox` (IB-1 to IB-9), `enquiry.channelIsolation` and
`access.staffPermissions` pass. The list never returns full message history. Staff requesting
another employee's thread gets `403` or `404`. Lane counts equal their filtered lists.

**Do not.** Return every thread's messages in the list. Expose internal notes to a route a
guest can reach. Add Unsorted or Unassigned as a status value (INV-43).

---

## 2C — Inbox actions

**Files.** `routes/admin/enquiryMessages/*`, `routes/admin/enquiryAssignment/*`,
category and status handlers in `routes/admin/enquiries/*`.

| Method | Path | Guard |
|---|---|---|
| POST | `/enquiryMessages/:enquiryId` | `assignedOrAbove` — **send** a guest-visible reply. Stamps `first_staff_reply_at`, queues simulated delivery on the originating channel |
| POST | `/enquiryMessages/:enquiryId/notes` | `assignedOrAbove` — internal note |
| PATCH | `/enquiries/:enquiryId/category` | `assignedOrAbove` — re-runs routing, clears `needs_review`, records before/after |
| PATCH | `/enquiries/:enquiryId/status` | `assignedOrAbove` |
| GET | `/enquiryAssignment/assignable` | employee — active employees and teams only, no account admin data |
| POST | `/enquiryAssignment/:enquiryId/assign` | `requireGm` |
| POST | `/enquiryAssignment/:enquiryId/claim` | employee, own team |

Sending is the explicit human act that turns a draft into a message (INV-46). A reply on an
email or WhatsApp thread stays on that channel.

**Exit.** `enquiry.inbox` (IB-10 to IB-18) and `enquiry.lifecycle` pass: a draft cannot become
a message without an explicit send; a reroute works; a reopened thread whose old assignee is
disabled goes Unassigned.

**Do not.** Auto-send. Include internal notes in an outgoing reply (INV-41). Count a failed
delivery as a reply (INV-26). Give a rerouting staff member read access to other threads.

---

## 2D — AI pipeline

**Files.** `src/adapters/ai/{gemini,prompts,responseSchemas}.ts`,
`src/core/enquiry/processing.ts`, `routes/admin/enquiryDrafts/*`,
`jobs/handlers/{classifyEnquiry,draftEnquiryReply}.ts`.

| Method | Path | Guard |
|---|---|---|
| POST | `/enquiryDrafts/:enquiryId` | `assignedOrAbove` — generate or regenerate; supersedes the pending draft |
| POST | `/enquiryDrafts/:enquiryId/retry` | `assignedOrAbove` — bounded retry of a failed stage |

Pipeline, never inside a transaction (INV-20):

1. **Classify + extract** — `generateStructured` with a response schema.
2. **Zod parse** the result.
3. **Semantic validation** beyond shape: dates resolve to real calendar dates and are not
   past, guest counts and nights within bounds, budget numeric, category in the enum.
   Ambiguity preserves the original wording and stores the interpretation as tentative
   (INV-48).
4. **Route** by backend rule — `routeEnquiry`. Complaint → GM alert regardless of confidence
   (INV-18).
5. **Assemble context** — guest-visible thread, current `resort_info`, backend-computed prices
   and availability, and the one booking the backend verified is linked (INV-21, INV-22).
6. **Draft** — authoritative price text supplied as a rendered block from `calculateQuote`.
7. **Validate the draft** — reject or flag monetary claims absent from that block. Guest budget
   kept separate from any resort offer. Missing event price requires human confirmation
   (INV-45).

Failures, all visible (INV-47): schema invalid → rejected, GM review · semantically invalid →
same · low confidence → `needs_review`, Unsorted lane · timeout or provider error → enquiry
intact, failure shown, bounded retry. Every run records provider, model, prompt version,
knowledge version, status, validation errors, latency (INV-49).

**Exit.** `bun run preflight` green first. Then `ai.validation` and `ai.boundary` pass. Only
`generateStructured` contacts the provider, and only `processEnquiry` calls it.

**A real Gemini call must actually run on a seeded enquiry**, and the report says which model
answered, the latency, and the `ai_runs` row it wrote. The validation and boundary tests are
written against recorded or stubbed provider output — that is correct, they test *our*
handling — but at least one end-to-end classify-and-draft must hit the live API. A stub
everywhere is not evidence the pipeline works.

**Do not.** Give the model a tool, SQL, a booking id from a message, or any write capability
(INV-44). Put internal notes in a prompt. Let the model compute a price. Store raw prompts in
general logs. Treat prompt wording as the security boundary.

---

## 2E — Staff reads and export

**Files.** `routes/admin/rooms/*`, `routes/admin/bookings/*`, `routes/admin/bookingCalendar/*`,
`routes/admin/exports/*`.

| Method | Path | Guard |
|---|---|---|
| GET | `/rooms` · `/rooms/:roomTypeId` | employee — room info, capacity, cover photo, effective prices and availability for a window. **Exists because §5 grants reservations and sales exactly this**, and they must not call the user tree |
| GET | `/bookings` · `/bookings/:bookingId` | employee — read-only purchased prices and guest contact |
| GET | `/bookingCalendar` | employee — per-room-type occupancy and allotment by date |
| GET | `/exports/bookings.csv` | `requireExporter` — **not sales** (INV-37) |

CSV: filtered by **confirmation date** in `Asia/Kolkata`, `from`/`to` inclusive, same date
allowed. One row per booking-room with the reference repeated; the row format documented in the
header. Guest text starting `=`, `+`, `-`, `@`, tab or CR is prefixed with `'` (INV-51). Every
export is audited with actor and range.

**Exit.** `export.csv` passes: sales gets `403`, reservations/GM/owner succeed, a guest name of
`=SUM(A1:A9)` comes out inert, the audit row exists.

**Do not.** Add any booking mutation route — dates, rooms, cancellation and refunds are out of
scope (§29). Let sales export. Recompute prices for display instead of reading the snapshot.

---

## 2F — Rates, inventory, blackouts

**Files.** `routes/admin/rates/*`, `routes/admin/inventory/*`, `routes/admin/blackouts/*`.

| Method | Path | Guard |
|---|---|---|
| GET | `/rates` | `requireGm` — base price and allotment plus overrides and blackouts in a window |
| PATCH | `/rates/room-types/:roomTypeId` | `requireGm` — base nightly price |
| POST | `/rates/preview` | `requireGm` — dry run: what a range edit replaces, which dates conflict |
| PUT · DELETE | `/rates` | `requireGm` — apply/remove a date-range price override |
| GET | `/rates/history?roomTypeId&from&to&kind` | `requireGm` — one combined feed, a **scoped projection** of `audit_events` limited to `rate.*`/`allotment.*`/`blackout.*` (INV-39) |
| PATCH | `/inventory/room-types/:roomTypeId` | `requireGm` — base allotment |
| GET · POST `/preview` · PUT · DELETE | `/inventory` | `requireGm` |
| GET · POST `/preview` · PUT · DELETE | `/blackouts` | `requireGm` |

All writes take the **same locks in the same order** as a reservation (INV-3). Allotment is
refused if any date would fall below confirmed + live holds, and the error names **every**
offending date (INV-9). Removing an override is re-validated against the resulting base value.
Allotment can never exceed physical stock. Blackouts stop new bookings but honour existing
commitments (INV-27). Audit every change.

**Confirmation and concurrent edits use one mechanism, shared by all three features.**
`POST /preview` returns `{ affected, conflicts, previewToken }`, where the token hashes the
current state of every `room_day` row the edit would touch. The matching `PUT`/`DELETE`
**requires** that token and recomputes it inside the transaction *after* taking the locks; a
mismatch is `409 stale_write`. That is both "show what will be replaced and require
confirmation" (§12) and the guarantee that a newer admin edit is never silently overwritten —
INV-57, signature in `04-contracts.md`. Do not invent a per-feature variant of this.

**Exit.** `preview.staleWrite`, `admin.allotmentSafety` and `pricing.snapshot` pass: an
allotment cut below commitments is refused naming dates; a blackout leaves existing bookings intact; a base-price
change leaves every sold and held total untouched (INV-28).

**Do not.** Edit a `tax_config` row in place — add a new version. Skip validation on an
override *removal*. Accept a `PUT`/`DELETE` without its `previewToken`. Recompute the token
before taking the locks — it must be recomputed after, or it proves nothing. Return raw audit
rows from `rates/history`.

---

## 2G — Promos and resort information

**Files.** `routes/admin/promos/*`, `routes/admin/resortInfo/*`.

| Method | Path | Guard |
|---|---|---|
| GET · POST | `/promos` | `requireGm` — percent (bps) or fixed (paise), expiry, usage limit |
| PATCH | `/promos/:promoId` | `requireGm` — edit or deactivate |
| GET | `/promos/:promoId/redemptions` | `requireGm` — held, consumed, released |
| GET · PUT | `/resortInfo` | `requireGm` — publish a new version; current = highest |

**Exit.** `promo.admin` and `promo.concurrency` pass: parallel redemption at the cap holds, and
editing or deactivating a code never changes a sold booking's snapshotted discount (INV-28).

**Do not.** Add campaign targeting, loyalty points or referrals. Let a promo edit recompute an
existing booking. Allow stacking.

---

## 2H — Reports, audit, final sweep

**Files.** `routes/admin/reports/*`, `routes/admin/audit/*`.

| Method | Path | Guard |
|---|---|---|
| GET | `/reports/metrics` | `requireOwner` — confirmed booking value, website room nights sold, allotment utilisation, median first **human** reply time, average resolution time. Each ships its definition |
| GET | `/reports/funnel` | `requireOwner` — visit → search → checkout → confirmed, plus visit → enquiry-submitted as a separate conversion |
| GET | `/audit` | `requireOwner` — paginated, filters by actor, action, target, date. Read-only; no write route exists (INV-14) |

Definitions, shipped with the numbers (INV-54, 55, 56): first reply = human-sent, successfully
delivered, guest-visible — an AI draft is not a reply, a failed delivery is not a reply ·
working hours 09:00–19:00 IST, the clock pauses outside · a reopened thread measures to its
latest resolution with the reopen count shown · waiting work is shown, not excluded to flatter
an average · booking value by confirmation date, labelled as to tax · live holds are never sold
nights · no profit claim, no total-resort-occupancy claim, no claim the client's direct-share
target was met.

**Final sweep.** Audit coverage for every mutation listed in `00-conventions.md`. Grep for
leaked secrets in repo, logs and bundles (INV-53). Confirm the tree separation greps are still
clean.

**Exit.** `reports` (RP-1 onward) and `audit` (AU-1 onward) pass, then the full phase-2 suite
is green. Every metric response carries its definition string.

**Do not.** Expose a general audit read to a GM. Label website-only metrics as complete resort
financials. Present synthetic demo numbers as commercial results.

---

## Standing rules for every sub-phase

- Permissions enforced per route, from `02-permissions.md`. Hidden navigation is not a control.
- Admin writes use the same locks and validation as reservations.
- Internal notes never reach a guest view, an outgoing reply or a prompt.
- No booking mutation, cancellation or discretionary refund route exists anywhere.
- Audit covers owner actions too, and nothing edits it.
- Every limit comes from `core/policy.ts` (INV-59).
- Admin range writes carry a `previewToken` recomputed under lock (INV-57).
- Update `04-contracts.md`, `06-touch-map.md` and this file in the same commit as the code.
