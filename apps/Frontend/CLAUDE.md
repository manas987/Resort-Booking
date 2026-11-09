# apps/Frontend

Vite 8 + React 19 + TypeScript. One app serving both the guest site and the staff console,
split so guests never download console code.

Start at the root `CLAUDE.md` for the product and the docs map. Phase 3 (guest) is in
progress: `Docs/12-phase3-frontend-guest.md` for sub-phase status and do-nots,
`13-frontend-structure.md` for layout/routes/state/styling, `14-frontend-api-map.md` for the
exact shape of every guest endpoint. Phase 4 (staff console) is not started.

`bun run dev` proxies `/api → http://localhost:3001` (`vite.config.ts`) — run the backend dev
server alongside this one; nothing in the guest app talks to the API any other way.

## Rules

- **No CSS framework.** Plain CSS with custom-property tokens in `src/index.css`. Reason: the
  guest JS budget is tight (below) and the design is a restrained palette with a lot of white
  space, which costs almost nothing to write by hand.
- **No date library, no chart library.** `<input type="date">`, `Intl.DateTimeFormat`, inline
  SVG. The native controls are also the accessible ones.
- **Routing**: `wouter` (~2 KB), not react-router — chosen for the budget.
- `React.lazy` every `/console/*` route and `/account`. A guest must never fetch a console or
  chart chunk.
- Public pages (`/`, `/rooms`, `/rooms/:slug`, `/events`) are pre-rendered at build time via
  Vite's SSR build. **Never pre-render** availability, prices, GM-editable facts or anything
  private — those come from the API at runtime.
- The backend owns all amounts. Display what the API returns; never compute a total here.
- Nothing sensitive in `localStorage` — no tokens, no personal data, no private messages.
  Non-sensitive search/selection state is fine.
- Every view needs its loading, empty, error and expired states. No dead buttons.
- Accessibility is not optional: visible labels, keyboard operation, focus states, contrast,
  announced status changes, real alt text. Never convey meaning by colour alone.

## Budgets (targets — claim them only once measured)

Initial guest JS ≈120 KB compressed · first mobile hero ≈100 KB · above-fold transfer
≈350 KB · no hidden full-gallery download on first load · no console bundle in the guest
entry.

Measure on a cold cache at ~1 Mbps / 400 ms RTT with CPU throttling, and record the real
numbers in `Docs/03-decisions.md`.

## Commands

```
bun run dev          bun run build        bun run preview
bun run lint         bun run check-types
```
