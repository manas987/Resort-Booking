# apps/Frontend

Vite 8 + React 19 + TypeScript. One app serving the guest site and the employee console, split
so a guest never downloads console code.

This file is the practical "how do I run and find things" note. The rules live in
`CLAUDE.md`; the design and contracts live in `Docs/13-frontend-structure.md` and
`Docs/14-frontend-api-map.md`.

## Running it

```
bun run dev            # Vite on :5173, proxying /api → http://localhost:3001
bun run build          # tsc -b && vite build
bun run preview        # serve the built output
bun run check-types    # tsc -b
bun run lint           # eslint .
bun run check          # the checks/ scripts + every bun:test file in checks/
```

The backend must be running alongside `dev` — nothing in this app reaches the API any other
way than the `/api` proxy in `vite.config.ts`. From `apps/Backend`: `bun run dev`, plus
`bun run worker` in a second terminal, because payment confirmation and AI classification are
done by the worker, not by the request that triggers them. Both read `DATABASE_URL`
independently at startup; pointing them at different databases is how a booking sits at
`pending_payment` forever with no error (`Docs/08-known-issues.md`).

## Layout

```
src/
  App.tsx            route dispatch, the home page, the chat/account dialog
  components/        one file per screen or shared widget
    retro-pill/      vendored subtree, preserved verbatim, own ESLint carve-out
    bencho/          vendored image-accordion subtree
  lib/               framework-agnostic helpers — no JSX in this folder
  data/              static content and small pure helpers
  console/           the employee console (lazy, see its own README.md)
checks/              plain-assert scripts and bun:test files, run by `bun run check`
```

`src/lib/` is where each concern lives exactly once: `api.ts` is the only module that calls
`fetch`; `session.ts` holds the access token in memory and nothing else holds it; `types.ts`
mirrors the guest API by hand; `money.ts` formats and never computes; `useResource.ts` is the
fetch-on-deps hook. `Docs/13-frontend-structure.md` has the full table.

## Guest routes

| Path | Screen |
|---|---|
| `/` | Home — hero, search, estate sections, approved resort info from `GET /content` |
| `/rooms` · `/rooms/:slug` | Catalogue and room detail with the availability calendar |
| `/book/select` | Room and quantity selection with per-room availability |
| `/checkout` | Quote, full §8D review, inline sign-in, mock payment — one screen |
| `/booking/:bookingId` | Confirmation (§8E), with the support/enquiry action |
| `/account/bookings` · `/account/enquiries` · `/account/profile` | §8F, lazy-loaded |
| `/events` | Weddings and offsites, §8G form, lazy-loaded |
| `/signin` · `/auth/callback` | Real OTP sign-in; the Google redirect lands on the callback |
| `/console/*` | Employee console, lazy-loaded |

Internal navigation uses `<Link>` from `wouter`, never a plain `<a href="/...">` — an anchor to
an internal path triggers a full document reload and throws away the in-memory session and cart.

## State

The access token lives in a module variable in `src/lib/session.ts` and is never written to
`localStorage` or `sessionStorage`; the refresh credential is an httpOnly cookie the browser
owns outright. `sessionStorage` carries only non-sensitive things: the idempotency key paired
with the exact body it was minted for, the current `quoteId`, the console's list/board
preference, and the analytics anon/session ids.

The cart is in-memory `useState` and a refresh resets it. That is deliberate and documented,
not an oversight.

## What is NOT done

- **The employee console is not wired to the API.** Every screen exists and runs on
  `src/console/model.ts`, a browser-side copy of the staff rules; 0 of the 55 `/api/admin`
  endpoints are called. See `src/console/README.md` and `Docs/08-known-issues.md`.
- **No prerendering yet.** `Docs/12-phase3-frontend-guest.md`'s 3G (`scripts/prerender.mjs` for
  the public pages) is still outstanding, so these pages need JS to render.
- **Budgets are measured only in part.** The hero image is measured and recorded in
  `Docs/03-decisions.md`. The initial-JS and above-fold transfer targets in `CLAUDE.md` have
  not been measured on the throttled cold-cache profile and are therefore still targets, not
  results.
- **Nothing here has been verified in a browser.** There is no headless browser in the
  development environment used to build this, so layout and interaction claims rest on
  type-checking, lint, the `checks/` scripts and static render output only.
