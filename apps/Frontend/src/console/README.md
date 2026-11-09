# Employee console

Open `/console` on the Vite frontend. `App.tsx` adds a lazy boundary and each screen loads
separately, so none of this reaches the guest bundle.

**Two screens are live against the staff API** and need the backend running:
**Rates & allotment** (`RatesLive.tsx`) and **Enquiries** (`EnquiriesLive.tsx`). Staff sign-in
is real — `POST /api/admin/auth/login`, argon2id, rate-limited per account — and the session
restores from the refresh cookie on reload. `api.ts` owns staff requests; reviewer inbound messages use a separate system endpoint.

**The other screens still run on local fixtures** in `model.ts` and work with no backend:
Overview, Bookings, Rooms, Management, Reports and Activity. `Docs/08-known-issues.md` explains
why those fixtures cannot be deleted yet.

## Reviewer accounts

Quick-access shortcuts submit seeded credentials to the staff API. Reviewer controls appear in development or builds with `VITE_DEMO_MODE=true`; this UI flag grants no API access. The inbound-message endpoint independently requires backend `DEMO_MODE`. Keep both disabled for a real production deployment.

Seeded by `apps/Backend/seeds/run.ts`:

| Username | Role | Scope |
|---|---|---|
| owner | Owner | Everything, including reports and the audit log |
| gm | GM | All operational screens and staff management |
| arjun | Reservations staff | Assigned enquiries, booking and room reads, CSV export |
| divya | Sales staff | Assigned enquiries, booking and room reads |
| priya | Reservations, **disabled** | Sign-in rejected by the server |

No password or private record is written to browser storage; the access token lives in a module variable and the refresh credential is an httpOnly cookie. Only the List/Board preference is kept in session storage. On the fixture-backed screens a refresh still resets local edits.

## Screens and interactions

- Role-specific overview; first-reference compact sidebar, responsive drawer navigation, notifications and profile.
- Enquiries **(live)**: **List and Kanban views of the same filtered records** — board columns are the four conversation statuses, and cards use native drag/drop or focused-card Left/Right keys, with Enter to open and announced results; Unsorted / Unassigned / Complaints lanes with status, source and search filters; the real conversation with internal notes kept visually separate; real Gemini drafts you edit and explicitly send (sending verbatim passes `draftId` so the reply is attributed to its `ai_run`, editing does not); classification correction that reroutes; manager assignment or staff self-claim; and the activity history.
- Bookings: read-only list/month/week calendar/detail, separate payment statuses, multi-room purchased snapshots, confirmation-date CSV export for reservations/GM/owner, formula-safe CSV cells.
- Rooms: room information, website availability matrix, confirmed/held/available breakdown and date-cell details.
- Rates **(live)**: inline base price/allotment forms, date rows with per-date/range override editing, and a secondary History drawer. Base saves use separate PATCH endpoints. Override writes require the `previewToken` the preview returned, so a save can only go through on dates the GM actually reviewed; a stale token is refused with `stale_write`. Oversell protection and the date-range rules are the server's — this screen shows its errors rather than re-checking.
- Management: validated promo forms, versioned approved information with editing/preview/history, employee creation/edit/disable and unresolved-work reassignment. Owner accounts protected.
- Owner reports: fixture-derived purchased booking value, sold nights, website allotment utilisation, delivered-reply and resolution metrics, cohort funnel and table alternatives. Read-only audit includes owner actions.
- GM/owner Workspace tools (reviewer mode): deterministic loading/error/offline/session-expiry scenarios and fixture enquiries, complaints and AI failures, plus a separate API-backed inbound-message form.

## Boundaries and assumptions

- Authentication, live enquiry processing and rates use the API. Other screens listed above use fixtures; their edits reset on reload. Google employee verification is unavailable in this UI. Messages use mock delivery adapters; no external email or WhatsApp is sent. Checkout keeps a no-charge notice; its outcome selector remains available in reviewer mode. Removing captions does not complete unwired screens.
- The demo clock starts at 9 Nov 2026, 10:30 Asia/Kolkata, and advances one minute per saved action. Every elapsed-time and expiry question goes through `now(state)` in `model.ts`, so reply ages and hold expiry agree. The seeded hold runs 10 minutes (matching `POLICY.expiry.paymentHoldMinutes`) and lapses as you work, returning the room to website availability. Nothing expires through a server worker.
- Synthetic stock distribution: 24 Estate Rooms, 24 Garden Rooms, 16 Estate Suites, 12 Villas. Only the original 64-room/12-villa totals come from the brief. Prices, tax snapshots, capacities, names and session data are synthetic and do not establish applicable GST or actual resort facilities.
- The three original enquiry IDs/messages are retained exactly. Missing years/facilities are explicitly unconfirmed.
- Reply times use calendar minutes, not a working-hours SLA. Resolution averages include resolved, never-reopened threads only. Failed deliveries, AI drafts and notes are excluded from reply counts. Unanswered work remains visible.
- Booking value is by confirmation date and includes synthetic purchased tax. Sold nights and utilisation use stay dates. Active holds are excluded from sold nights. Historical utilisation uses the demo calendar configuration; real historical reporting requires versioned inventory history.
- Funnel sessions are explicit synthetic fixtures linked to booking outcomes, not live tracking. No profit, overall resort occupancy or achieved commercial targets are claimed.
- Existing guest-facing API code is not used by this console. `src/console/model.ts` re-implements staff rules in the browser and is **scaffolding**: `apps/Backend/src/routes/admin/` already serves ~45 endpoints for the same rules, and its header lists every limit that diverges from `apps/Backend/src/core/policy.ts` and must be reconciled when Phase 4 wires this up.

## Verification

From `apps/Frontend`:

```
bun run build
bun run lint
bun run check      # the three plain-assert scripts plus every bun:test file in checks/
```

Domain checks cover role boundaries, failed delivery/retry, draft/send separation, disabling/reopening, inventory consistency, overlap/stale-edit checks, snapshot preservation, safe CSV, information versions and reporting reconciliation. Static render checks cover the main routes and restricted thread/export output. Browser visual/mobile interaction verification was not performed: browser control timed out. Live rate-mutation verification was blocked by automatic approval review; see `Docs/console-ui-fixes.md`.
