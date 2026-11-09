# Frontend API map

Every guest endpoint, its exact wire shape and which screen consumes it. The file that stops a
future session guessing a shape instead of reading `04-contracts.md`. **Wire casing is
camelCase** (`maxAdults`, `totalPaise`, `checkIn`) — `00-conventions.md`'s "Naming" section
says snake_case on the wire; that line is wrong, every controller returns camelCase, and the
correction is tracked there.

Base path `/api/user`, proxied in dev via `vite.config.ts` (`/api → http://localhost:3001`).
Backend listens on `:3001`. Every non-2xx is `{error:{code,message,details,requestId}}` — see
`ErrorCode` in `src/lib/types.ts` for the full union and `00-conventions.md` for the status
table. Money is integer paise, fields suffixed `Paise`, formatted client-side with
`src/lib/money.ts` only — never computed there. Dates are `YYYY-MM-DD`, check-in inclusive /
checkout exclusive, "today" in `Asia/Kolkata`.

## What is actually wired (as of 2026-11-09)

**All 30 guest endpoints are now called from the frontend.** Verified by grepping every
`apiFetch` call site, not by reading this file. 3F wired the account and event screens, and the
four that were not waiting on anything were fixed: `POST /auth/logout` (sign-out now reaches the
server), the Google redirect pair (`/signin` navigates to `/auth/google/start`; the client-side
credential decode is gone), and `GET /quotes/:quoteId` (checkout recovers its quote on reload
instead of silently minting a new one).

The staff tree is partly wired: the console's **Rates** and **Enquiries** screens call
`/api/admin/*` through `src/console/api.ts`, and staff sign-in is real. The other six screens
still read local fixtures. `Docs/08-known-issues.md` says exactly which.

## Auth

| Endpoint | Guard | Used by |
|---|---|---|
| `POST /auth/register` | none, rate-limited | `/checkout` sign-in — called first to learn new-vs-returning (a duplicate 400 means returning), since verify never distinguishes "wrong code" from "no such guest" |
| `POST /auth/otp/request` | none, rate-limited | `/checkout` sign-in, `/account/profile` contact change |
| `POST /auth/otp/verify` | `optionalGuest` | same |
| `GET /auth/google/start` | none | `/signin`'s "Continue with Google" — a full-page navigation, never a `fetch` |
| `GET /auth/google/callback` | none | redirects to `/auth/callback#accessToken=`, read by `App.tsx`'s `AuthCallback` |
| `POST /auth/refresh` | none, reads `resort_refresh` cookie | `api.ts`'s silent 401 retry, and once on app boot |
| `POST /auth/logout` | none, reads cookie | account sign-out, via `signOut()` in `lib/session.ts` — the cookie is revoked server-side, and a failed call leaves the UI signed in rather than lying |
| `GET /auth/me` | `requireGuest` | after `/auth/callback`, and on 401-retry success |

**Access token**: in the JSON body (`accessToken`), sent as `Authorization: Bearer`. **Never a
cookie.** **Refresh token**: httpOnly cookie `resort_refresh`, path `/api/user/auth`, rotated
every call, reuse of an already-rotated token revokes the whole session (INV-16) — the browser
handles this cookie entirely; the frontend never reads or writes it directly.

`POST /auth/otp/request` body: `{destinationKind:'email'|'phone', destination, purpose:
'guest_signup'|'guest_login'}` → `{expiresAt, demoCode?}`. `demoCode` only appears when
`DEMO_MODE=true` and the destination is a seeded demo identity.

`POST /auth/otp/verify` body: `{destinationKind, destination, purpose, code}` → on success,
`{accessToken, principal}` + refresh cookie set. `purpose` also takes `verify_email`/
`verify_phone` for an already-signed-in guest (needs a bearer token on that call) — this is
how `/account/profile`'s contact-change flow completes.

**Google**: full-page navigation to `GET /auth/google/start`, not a `fetch`. Ends in a `302` to
`${APP_ORIGIN}/auth/callback#accessToken=<jwt>` — the fragment never reaches a server, so
`/auth/callback` (`src/App.tsx`'s `AuthCallback`) is the only place it's read, then
`GET /auth/me` fills in the `Principal`.

## Account

`PATCH /account/profile` `requireGuest` — body `{name}` → `{name}`. Name only; email/phone
never change here (ownership safety, INV-34).

`POST /account/contact/verify-start` `requireGuest` — body `{destinationKind, destination}` →
`{expiresAt, demoCode?}`. The new value is written only once `POST /auth/otp/verify` with
`purpose: verify_email|verify_phone` succeeds.

## Content, rooms, availability

`GET /content` — no guard. `{content: [{key, title, body, version}]}`.

`GET /rooms` — no guard. `{rooms: RoomListing[]}` — see `types.ts`. Used by `/rooms` (3D).

`GET /rooms/:slug` — no guard. `RoomDetail` (adds `description`, `photos`). `404 not_found` if
inactive/missing. Used by `/rooms/:slug` (3D).

`GET /availability?checkIn=&checkOut=&adults=&children=&rooms=` — no guard, `no-store`.
`{checkIn, checkOut, rooms: AvailabilityRoom[]}`. **One `remaining` per room type for the
whole stay** — the minimum across every night, not per-date. Used by `/book/select` for the
"N left for your dates" badge.

`GET /availability/calendar?slug=&from=&to=` — **added in 3B.** No guard, `no-store`. Window
≤62 days, inside today..+365 (Asia/Kolkata). `{slug, days: [{date, remaining, pricePaise,
isBlackout}]}`. Used by the `/rooms/:slug` availability-calendar panel — the endpoint the
per-date UI actually needs, since `GET /availability` collapses every night into one number.
`404 not_found` for an unknown/inactive slug.

## Quotes and promos

`POST /quotes` `optionalGuest`, rate-limited. Body `{checkIn, checkOut, rooms: QuoteLineItem[]
(1..4), promoCode?}`. **A `QuoteLineItem` is one physical room**, `{roomTypeId, adults,
children}` — not a quantity; `core/pricing.ts` iterates the array with no multiplier, and
`POLICY.maxRoomsPerBooking` (4) caps the array length across all room types combined. Nights
capped at `POLICY.maxNightsPerBooking` (14). `201 {quoteId, checkIn, checkOut, pricing:
QuoteResult, roomPaise, discountPaise, taxPaise, totalPaise, taxConfigVersion, termsVersion,
expiresAt, expired}`. Quote lifetime `POLICY.expiry.quoteMinutes` (5 min), server-stamped.

**An anonymous quote survives sign-in** — `guest_user_id === null` is always treated as owned,
by anyone. So `/checkout` can quote before auth and only needs sign-in before `POST
/bookings`. What ownership *does* block: a quote made while signed in as guest A can never be
booked by guest B (checked in `core/booking.ts`, not `quotes/controllers.ts`'s read path).

`GET /quotes/:quoteId` `optionalGuest` — same shape, `404` whether missing or owned by someone
else (never `403` — INV-34 anti-leak). Used by `/checkout` on load: the `quoteId` is kept in
`sessionStorage` keyed by a signature of the exact stay, so a reload reuses the existing quote
and its 5-minute window instead of minting a new one. A `404` or an `expired` flag falls through
to a fresh `POST /quotes`.

`POST /promos/validate` — no guard, tightly rate-limited (20/5min). Body `{code}` → always
`200`, `{valid:false, reason}` or `{valid:true, kind:'percent'|'fixed', value}`. Reserves
nothing; capacity is only checked at hold time.

## Bookings and payments

`POST /bookings` `requireVerifiedGuest` (**both** email and phone) + required
`Idempotency-Key: <uuidv4>`. Body `{quoteId, guestName, guestEmail, guestPhone}`. `201
{bookingId, reference, holdExpiresAt}` — `reference` is the guest-facing `BK-XXXXXXXX` code;
`bookingId` (uuid) is used for every subsequent route. Hold life
`POLICY.expiry.paymentHoldMinutes` (10 min).

Error branches, each with its required UI response:

| Error | Status | What the UI does |
|---|---|---|
| `availability_conflict` | 409 | `details.conflicts` names the nights — send the guest back to `/book/select` to revise |
| `quote_expired` | 410 | re-quote (`POST /quotes` again) |
| `quote_already_booked` | 409 | show the **existing** booking — never retry (INV-60) |
| `price_changed` | 422 | `details = {quoteId: <fresh quote>, ...QuoteResult}` — show the new total, require explicit acknowledgement, retry `POST /bookings` with the fresh `quoteId` |
| `promo_exhausted` | 409 | drop the promo, re-quote |
| `hold_expired` | 410 | restart from `/book/select` |
| `idempotency_key_reused` (in-flight) | 409 | **not a failure** — poll and retry; see `isInFlightReplay` in `api.ts` |

`GET /bookings?limit=&cursor=` `requireGuest` — keyset, `{items: Booking[], nextCursor}`. Used
by `/account/bookings`.

`GET /bookings/reference/:reference/status` `requireGuest` — cheap poll, `{reference, status,
holdExpiresAt}`. Used by `/checkout` while waiting for the worker to confirm payment.

`GET /bookings/:bookingId` `requireGuest` — full `Booking`. Used by `/booking/:bookingId` and
`/account/bookings`' detail view. `status`: `pending_payment | confirmed |
payment_failed | expired`.

`POST /payments/:bookingId/attempts` `requireVerifiedGuest` + required `Idempotency-Key`. Body
`{outcome?: 'succeed'|'decline'|'succeed_late'}` — **honoured only when `DEMO_MODE=true`**,
otherwise always `'succeed'`. `201 {paymentId, providerRef}`. **Confirmation itself is not a
guest-callable endpoint** — the job worker confirms asynchronously; the guest polls booking
status.

## Enquiries and events

`POST /enquiries` `requireGuest` — body `{message}` → `201 {enquiryId, publicRef}`. The chat
dialog's "Send message" posts here and shows the returned `publicRef`.

`GET /enquiries?limit=&cursor=` `requireGuest` — keyset, summaries. `/account/enquiries` list.

`POST /enquiries/from-booking/:bookingId` `requireGuest` — body `{message}`, ownership checked
server-side. Used by the "support/enquiry" action on `/booking/:reference` and
`/account/bookings`.

`POST /enquiries/:enquiryId/messages` `requireGuest` — body `{message}` → `{enquiryId}`.
Thread reply.

`GET /enquiries/:enquiryId` `requireGuest` — `{..., messages}`, **guest-visible messages
only** — staff notes and AI internals are never in this response; don't try to surface them
from elsewhere either.

`POST /eventEnquiries` `requireGuest` — body matches §8G exactly (`EventEnquiryInput` in
`types.ts`): `eventType`, `preferredDates` (exact/month/flexible), `guestCount`, `roomsNeeded`,
`nights`, optional `budgetPaise`/`requirements`, contact fields. `201 {enquiryId, publicRef}`.
No package price, no deposit, no AI classification — `/events`' form (3F).

## Analytics

`POST /analytics/events` — no guard, rate-limited (120/5min). Fire-and-forget via
`src/lib/analytics.ts`. Body `{anonId, sessionId, type, dedupeKey?, payload?}`. Server-dedupes
on `dedupeKey`, so a retry is always safe.
