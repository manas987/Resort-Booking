# Employee console frontend plan

Scope: the approved admin UI prompt in this conversation, implemented as a local frontend demonstration. Do not inspect or modify the backend. Existing guest integration is preserved.

1. Add a lazy `/console` boundary to the existing wouter application; isolate CSS and demo identity from guest authentication.
2. Create shared synthetic data, role rules and validated local transitions. Four employee personas; website inventory separate from physical stock; purchased booking snapshots immutable.
3. Build the first-reference sidebar, responsive shell, notifications, demo sign-in and accessible drawer/table/form primitives.
4. Build enquiry list/board/thread with filtering, assignment, AI suggestions, explicit sending, delivery failure, reopening and history.
5. Build read-only booking list/calendar/detail/CSV; room information and availability matrix.
6. Build rates/allotment/blackout range edits, commitment checks, overlap review and version history.
7. Build promo, approved-information and employee management; disabling staff unassigns unresolved work.
8. Build role-specific overview, owner reporting/funnels and read-only audit from shared records.
9. Add deterministic loading/error/offline/session and AI/delivery scenarios. Verify build, lint and meaningful domain checks. No browser inspection unless requested.

Implementation: `apps/Frontend/src/console/` with per-page lazy modules, a small context/reducer and plain scoped CSS. No new dependencies. No persistent private browser storage. Demo edits reset on full refresh. All fixture names, stock distribution, rates, tax snapshots, working-hour conventions and analytics are synthetic assumptions. Google authentication and external message/AI delivery are not connected by this console.

Acceptance: every requested area reachable according to role; no booking mutation actions; shared list/board state; explicit reply sending; range validation and snapshots; consistent fixture-derived reports; functional CSV; focus/keyboard/mobile support; local permissions are not represented as server security.

Implemented: all listed screen areas and local transitions. First-reference sidebar, scoped responsive styles, shared drawer/table controls, per-page lazy loading. Domain and static route-render tests added. Build and lint pass; 24 console checks pass. Browser visual/interaction verification and real service integration remain outside this authorised pass. See `apps/Frontend/src/console/README.md` for demo identities, assumptions and recovery scenarios.
