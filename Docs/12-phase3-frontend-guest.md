# Phase 3 — frontend guest

Builds the guest site against the complete guest API (27 endpoints + 3B's calendar one).
`Implimnetation.md`'s status table says which sub-phase is next; `progress-log.md` records
what each finished one actually shipped and what proved it.

One sub-phase at a time, verified before the next starts. Do not redesign a contract already
fixed in `14-frontend-api-map.md` or `apps/Backend/src/core/policy.ts` — a better idea there
is a question for the user.

## Standing do-nots (all sub-phases)

- No route for a screen that doesn't exist yet — an empty route is a dead link (§28).
- The access token lives in memory only (`session.ts`). Never `localStorage`/`sessionStorage`.
- Never compute a total client-side; display what the API returns.
- Never retry on `409 quote_already_booked` — show the existing booking (INV-60).
- An `Idempotency-Key` travels with the exact body it was minted for (`lib/idempotency.ts`).
- Never render staff notes or AI internals on a guest screen.

## 3A–3E — done

### Guest booking UI refinement — 9 Nov 2026

User-directed update: the accordion's whole image is a details link (including the selected
dates); quantity controls remain separate sibling controls. The room booking panel uses a
compact price, human-readable dates, a labelled room counter and a checkout action. Related
room photographs now explicitly reset intrinsic HTML height and use a 3:2 crop.

Follow-up: “Check availability” is the prominent calendar trigger. This grid is read-only,
showing nightly availability/counts and the existing stay as context; it never changes booking
dates. Home remains the date picker. Loading/failure shows no misleading sold-out grid.
Removed the “Add a room to your stay using + above” helper as requested.

Checkout groups identical room types into one thumbnail row with the shared minus/count/plus
control. Individual physical-room occupancy remains available under “Guests per room”.
Removing the final room shows the empty state. New quotes come from the API after changes;
request sequencing and signature matching prevent an old selection's quote enabling payment.
No amount is calculated in the browser.

Per the latest request, checkout authentication goes to the existing /signin page rather
than embedding its form. Signed-out guests see no duplicate guest fields. Verified guests see
one main-guest form; native required/email/phone validation runs before payment. Only
non-personal cart selection and an internal return path are retained in session storage to
survive the full-page Google redirect. Tokens and guest contact details remain out of storage.
The return path is restored for OAuth as well as in-app OTP sign-in. The UI does not change
auth, quote, inventory, booking or payment API contracts.

Validation: check-types, lint, all check scripts (36 Bun tests, 236 assertions) and build
passed after these changes. Existing chunk-size/dynamic-import build warnings remain.
No backend files or data changed. Browser visuals, live availability and Google sign-in
round trips were not exercised in this pass.

Foundation and routing (3A), `GET /availability/calendar` (3B), curated room content in the
seeds (3C), rooms/availability/calendar screens (3D), checkout + booking + payment +
confirmation (3E). See `progress-log.md`'s Phase 3 section for what shipped, the three bugs
3D shipped and how they were fixed, and the current state of the dev setup.

## 3F — Account, enquiries, event form

**Builds:** `/account/bookings`, `/account/enquiries` + thread, `/account/profile`, `/events`
+ the §8G form. All `React.lazy`.

**Do-nots:** Never render staff-only notes or AI internals (`GET /enquiries/:id` already
excludes them server-side — don't re-expose anything via a different call).

**Exit:** an enquiry submitted from the browser, answered from the database, read back in the
thread.

## 3G — Prerender, images, measured budgets

**Builds:** `scripts/prerender.mjs` (`vite build --ssr` + `renderToString`) for `/`, `/rooms`,
`/rooms/:slug`, `/events`. Real `srcset`/`sizes` everywhere.

**Do-nots:** Never bake availability, prices or private data into the static output (§19).

**Exit:** JS-disabled load of `/` and `/rooms/:slug` still shows marketing copy; budgets
measured on the throttled profile and written to `03-decisions.md` — not claimed without that.

## 3H — States, accessibility, checks, close-out

**Builds:** loading/empty/error/expired states per view, a small `:root` token layer for the
new work only, a11y sweep per §28, new `checks/` scripts, final doc sweep.

**Exit:** `bun run check-types`, `bun run lint`, `bun run check` all clean; every doc row
matches shipped behaviour.
