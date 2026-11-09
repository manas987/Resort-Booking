# Frontend structure

Where things live and the rules that hold them together. Read this before adding a file.

## Routes (wouter)

| Path | Screen | Added |
|---|---|---|
| `/` | Home | pre-existing |
| `/rooms` | Room list, from `GET /rooms` | **3D, done** |
| `/rooms/:slug` | Room detail from `GET /rooms/:slug` + the availability calendar panel | **3D, done** — `wouter` route param, not a static-array lookup |
| `/book/select` | Multi-room selection, a quantity pill per room type (no inline occupancy editor — see `03-decisions.md`) | **3D, done** |
| `/checkout` | Grouped room review with photos/quantities, per-room occupancy, main-guest form and payment. Sign-in opens `/signin` and returns to this selection. | **3E, done**; refined 9 Nov |
| `/booking/:bookingId` | Confirmation (§8E) — keyed by `bookingId`, not `reference` (see `03-decisions.md`) | **3E, done** |
| `/signin` | Fake-auth-turned-real demo sign-in | pre-existing |
| `/auth/callback` | Reads `#accessToken=` from the Google redirect | 3A |
| `/account/bookings`, `/account/enquiries`, `/account/profile` | My account (§8F) — bookings list, enquiry threads with replies, name and contact-change | **3F, done**, lazy (`Account.tsx`) |
| `/events` | Wedding/offsite intro + §8G form | **3F, done**, lazy (`Events.tsx`) |

A route is added by the sub-phase that builds its screen, not before — an empty route is a
dead link (§28).

**Internal navigation uses `<Link>` from `wouter`, never a plain `<a href="/...">`.** A plain
anchor to an internal path triggers a full document reload (loses in-memory session, cart and
dialog state); `<Link>` intercepts the click and calls `history.pushState`. Same-page fragment
anchors (`href="#explore-title"`, `href="#"`) are fine as plain `<a>` — they never change the
pathname, so the browser never reloads.

## `src/lib/` — the one place each concern lives

| File | Owns |
|---|---|
| `types.ts` | Hand-written mirror of the guest API contract (not generated). `QuoteLineItem` — one physical room, not a quantity — is defined here, used from 3D onward |
| `api.ts` | The only module that calls `fetch` against `/api/user/*`. Parses the error envelope into `ApiError`; single-flight silent refresh on one `401`, then retries once |
| `session.ts` | Access token + `Principal`, **module-scope variable, never storage**. `subscribeSession` for React to re-render on sign-in/out |
| `money.ts` | `formatPaise` — formats, never computes. Replaces `data/cart.ts`'s old `nightlyRate`, which parsed a display string like `'₹8,500'` |
| `useResource.ts` | ~40-line fetch-on-deps hook: aborts on dep change, guards a stale response. Not react-query — rung 6 of the ladder, a dependency for this much code is the wrong trade |
| `analytics.ts` | `trackEvent` — fire-and-forget `POST /analytics/events`, server-deduplicated so a retry is free. `anonId`/`sessionId` in storage (non-sensitive, explicitly allowed by `apps/Frontend/CLAUDE.md`) |
| `idempotency.ts` | `idempotentRequest(storageKey, body)` — the key and its exact body together in `sessionStorage`, reused on a byte-identical retry, replaced on a genuinely different one. One helper for every money/inventory POST (3E: booking, payment) |

## Components added in 3D

- `AvailabilityCalendar.tsx` — the native two-month grid (see the Phase 3 plan's "Why the
  calendar isn't built on react-day-picker" for why it isn't a `retro-pill` extension).
- `RoomList.tsx` — `/rooms`.
- `RoomQuantityStepper.tsx` — a bare "− N +" pill per room type, shared by `/rooms/:slug` and
  `/book/select`. Replaces an earlier `CartLineEditor.tsx` (adults/children editing inline on
  these screens) that the user asked removed — occupancy now lives on `/checkout` only.
- `src/lib/photoUrl.ts` — the generic Unsplash URL builder, extracted from the deleted
  `data/rooms.ts` since `PropertyTour.tsx`/`data/tour.ts` use it for unrelated illustrative
  photography, not catalog data.

## Components added in 3E

- `Checkout.tsx` — `/checkout`: internal review/pay steps, quote, promo, main-guest contact
  and missing-contact verification before mock payment. Owns `POST /bookings` → `POST /payments/:id/attempts` →
  poll-to-confirmed chain and every booking error branch.
- `CheckoutSignIn.tsx` — shared email-first OTP/onboarding flow on /signin, plus
  verificationOnly on checkout's pay step. New accounts verify phone then confirm name;
  returning accounts enter after email proof. Google prefill comes from the server profile.
- `BookingConfirmation.tsx` — `/booking/:bookingId`.

## State rules

### Employee console UI demonstration

The employee console is at `/console/*`, lazy-loaded through `App.tsx` and isolated in
`src/console/` (see its own `README.md`). Destinations: login, overview, enquiries/:id,
bookings/:reference, rooms, rates, management/{promos,information,team}, reports and activity.

**Rates & allotment and Enquiries are wired to `/api/admin/*`** via `src/console/api.ts`, which
is the only module in that folder allowed to call `fetch`. It is deliberately NOT shared with
`src/lib/api.ts`: a guest 401 and a staff 401 must never be able to refresh each other's
session, which is the same reason the backend keeps two route trees that share no HTTP code.

The remaining screens still read `src/console/model.ts`'s local fixtures. `08-known-issues.md`
says exactly which, and why those fixtures cannot be deleted yet.


- Access/refresh tokens: memory only (`session.ts`) + an httpOnly cookie the browser owns.
  Never `localStorage`/`sessionStorage`.
- Idempotency keys for money/inventory POSTs: the key **and its exact serialized body**
  together in `sessionStorage`, so a refresh replays byte-identical rather than double-booking
  or tripping `409 idempotency_key_reused` on a reconstructed body.
- Cart (`QuoteLineItem[]`, from 3D): in-memory `useState`, same as today — a refresh resets it,
  which is the documented behaviour already in `Frontend/README.md`.
- Search/selection state (dates, anon/session ids): sessionStorage/localStorage, explicitly
  allowed because none of it is sensitive.

## Naming and layout

- `src/components/` — one file per screen or shared widget, matching the existing convention.
- `src/lib/` — framework-agnostic helpers (API, types, formatting). No JSX in this folder.
- `src/data/` — static content and small pure helpers (`cart.ts`'s date math stays here even
  after its `Cart` type changes). `rooms.ts` is deleted in 3D once the API is the source.
- `retro-pill/` stays a vendored, verbatim-preserved subtree (its own ESLint carve-out) — new
  code is never added inside it; extend it only by forking, and only if a future decision says
  to (see the plan's note on the availability calendar).

## Styling

**Tokens barely exist.** `:root` has exactly two custom properties — `--ink:#223a2c`,
`--cream:#fffdf5`. Everything else (radii, shadows, spacing, the recurring near-black/cream/
green hex literals) is repeated per rule. The only real token system is inside
`src/components/retro-pill/` (Tailwind v4 `@theme`, compiled by `bun run pill:css`) — the
documented exception to "no CSS framework". New work adds its own literal CSS in a fenced
block at the end of `index.css`; a token refactor of 43 KB of working CSS is not in scope.

**Type.** No named scale. Display headings are `400 clamp(...)/1.1 Georgia,serif`; body is
Arial 12–15px, muted grey-green. The "eyebrow" pattern (`.room-eyebrow`, `.welcome-label`)
is 8–10px with heavy letter-spacing, uppercase by content not `text-transform`.

**Shapes worth matching** (they're shapes, not shared classes — most new screens write their
own literal CSS): `.booking-primary` black capsule CTA · `.solid-button` full-width dark pill
· `.room-inline-link` text + bottom border · `.popup` native `<dialog>` · `.quantity-control`
pill stepper with circular ± · `.checkout-summary`/`.room-booking` sticky side-card ·
`.checkout-empty`/`.payment-complete` the only real empty/completion states.

**Responsive:** `max-width:760px` collapses to one column, `max-width:640px` is the phone
tier. Grep `@media` in `index.css` for the full list.

**Reduced motion:** scoped per section — each animated block pairs with its own
`@media(prefers-reduced-motion:reduce)` right after it, never one global catch-all.

**Colour inheritance is the trap here.** `.acc-caption` sets `color:#fff` for its own
white-on-photo text, and anything rendered into it via `renderActions` inherits that — a
light-background card nested inside it renders white-on-white unless it sets its own `color`.
This shipped as a real bug twice (see `progress-log.md`, 3D). Any new component that can
render in both a light-card and a dark-photo context needs both colour cases written up front.

**States:** no skeleton or spinner CSS exists. Conventions to extend: disabled is
`opacity:.3` + no pointer events; errors are `.signin-error` + `role="alert"`; empty is
`.checkout-empty` (centred heading, muted paragraph, CTA). `EstateMap.tsx`'s placeholder →
ready → fallback is the model for every `useResource` consumer — never a blank screen.

**Accessibility (§28, non-negotiable):** visible labels, keyboard operation, focus states,
contrast, accessible validation, `aria-live` status changes, real alt text, and **nothing
conveyed by colour alone** — e.g. the availability calendar's per-day counts are text and
`aria-label`, never just a green/red cell.
