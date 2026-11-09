# Console UI fixes — 9 Nov 2026

## Submission check

Fixed nullable Activity target IDs (and nullable system actor roles) against the real API
contract. The running API returned 37 rows, including three null-target export events; their
target labels formatted without throwing. Browser control timed out, so rendered-page
verification is still unclaimed.

Live mock booking smoke check: BK-RDY3TC6W reached confirmed and its database payment row
is succeeded. This creates one synthetic reviewer booking in the configured app database.
Full backend suite: 332 passed, 10 opt-in tests skipped, zero failed (35 files).
Frontend: 44 tests passed, type-check/lint/build passed. Sample-card fields are decorative.

## Follow-up revision: activity-driven enquiries

The user's latest request supersedes the draggable four-column design below. The board now
has New, In progress and Resolved; cards only open conversations. An accepted staff reply
sets In progress atomically with the message and records status/reopening history. Delivery
metrics still wait for confirmed delivery. Resolving/reopening is an explicit thread action,
not a generic status dropdown. Legacy awaiting_guest rows are included in In progress reads,
filters and counts; no stored history is deleted and new status writes reject that value.
The guest account uses the same visible label. The fixture-backed screens follow these labels.

Search, status, source and List/Board share one desktop toolbar; narrower screens wrap them.
Checkout retains only the sign-in button in its right-hand summary.

Verified: frontend type-check/lint/check/build passed; backend type-check plus 27 inbox/lifecycle
tests passed against the guarded test database. No working database mutation was performed.

## 1. Enquiry detail lag

Confirmed source cycle: the detail loader marked read, called an inline parent callback, refreshed parent state and retriggered its own callback-dependent effect. The loader is now dependent only on enquiry ID. Read acknowledgement is a separate effect; the parent passes its stable list loader directly. Action completion reloads detail and parent once each, with no extra read acknowledgement.

Request plan per production mount: one detail GET, one mark-read POST, one assignable GET for managers, then one parent list/count refresh. Development StrictMode may mount effects twice; this remains bounded. Other live screen callbacks were checked: rates only calls onSaved after an explicit write, not from its load effect.

Live browser count: not observed. Browser control timed out; no request-count claim is made. Regression checks cover the dependency edge and separation of read/action refresh.

## 2. Draggable board

The card select is replaced with native HTML5 drag/drop. Columns highlight during a valid drag. Movement waits for the same status PATCH; records stay in their original column on failure. Focused cards support Left/Right arrows to move and Enter to open, with live announcements and in-flight disabling. No drag library or new dependency. Four status columns remain unchanged; review/assignment conditions remain lane filters.

## 3. View switch placement

List/Board now sits after search/status/source, aligned to the right of the enquiry filter row. On narrow screens the search takes a full row and the switch wraps without forcing page overflow. View behaviour and the shared records are unchanged.

## 4. Rates on one screen

Room defaults are inline forms above the date rows, with separate saves for base rate and base website allotment (the API exposes separate endpoints, so no combined atomic save is implied). Date range selection and per-date actions open the existing preview/confirm editor. History is a secondary drawer, not a competing page tab. PUT/DELETE still require the exact preview token and stale-write errors remain visible. No backend contract or inventory policy changed.

Live rate mutation verification was rejected by automatic approval review because it would modify backend data and persist audit entries. No live write results are claimed.

## 5. Sidebar

Brand link and collapse controls now occupy separate rows. Consistent 43–44px navigation rows, 18px icons, quieter group labels, a dark selected surface and a bounded profile row establish a regular rhythm. Collapsed navigation keeps its unread badge and accessible labels; mobile retains the drawer and gains an explicit close button. Existing wouter links and role filtering are preserved. Browser visual verification remains unavailable.

## 6. Product copy and reviewer tools

Removed workspace banners, fixture/date/reset captions and simulation wording across console reports, bookings, activity and guest verification. Messages are described as recorded rather than externally delivered. Checkout still explicitly states that no charge will be made.

Reviewer controls (role shortcuts, Workspace tools and payment outcomes) remain available in development or builds with VITE_DEMO_MODE enabled. The API independently controls mock endpoints with DEMO_MODE. This is a presentation choice, not authorisation. No API contract, payment outcome or delivery adapter changed. Fixture-backed screens remain incomplete integrations as documented in the console README and known issues.

## Checks run

After each issue, check-types, lint, check and build exited successfully before proceeding.
Issues 1–5 passed 29 Bun tests; issue 6 passed 30 tests with 203 assertions, plus the three
plain-assert scripts. Build retains its existing Mapbox chunk-size and ineffective dynamic-import
warnings. No commit, push, deployment or live rate mutation was performed.
