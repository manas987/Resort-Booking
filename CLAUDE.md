# Resort direct-booking + AI enquiry routing

Direct-booking website for a Chikkamagaluru coffee-estate resort (76 keys), plus one staff
console where enquiries from web, email and WhatsApp land, get classified by AI, routed to an
owner and answered from a reviewed draft. Internship-trial build. Mock payments, mock message
delivery, synthetic data.

**The graded slice:** room pages with live availability and price → booking with test payment
→ rate and allotment admin → enquiry inbox with AI routing. The hard requirement is that the
site never oversells its allotment.

## Start here

**`Docs/Implimnetation.md`** — the index. It holds the sub-phase status table, says which
sub-phase is next, and lists the exact order to read things in after a context reset. Read it
first; don't guess what to work on.

## Where to look

Open the one file you need. Don't load the folder.

| File | Open it when |
|---|---|
| `Docs/Implimnetation.md` | Picking up work. Status, next sub-phase, reading order |
| `Docs/Product.md` | You need the authoritative spec. 1700 lines — search it, don't read it whole |
| `Docs/00-conventions.md` | Money, dates, errors, pagination, idempotency, SQL, audit |
| `Docs/01-data-model.md` | Writing SQL or a migration |
| `Docs/02-permissions.md` | Adding a route or a guard |
| `Docs/03-decisions.md` | A verified fact, a labelled assumption, a policy default |
| `Docs/04-contracts.md` | **Calling anything in `core/` or `adapters/`** — exact signatures |
| `Docs/05-invariants.md` | `INV-1…60`. Cite these in comments instead of re-explaining |
| `Docs/06-touch-map.md` | **Before editing anything shared** — what else must change |
| `Docs/07-backend-structure.md` | Layout, controller order, naming, SQL and transaction style |
| `Docs/08-known-issues.md` | **Before reporting a bug or "fixing" something odd** — what is knowingly wrong and why |
| `Docs/09-test-harness.md` | **Before writing any test** — helpers, real concurrency, clock, failure injection |
| `Docs/progress-log.md` | What is actually finished, with the output that proved it. Append per sub-phase |
| `Docs/TDD.md` · `deployment.md` | The two submission deliverables |
| `Docs/10-phase1-backend-guest.md` | Guest API, sub-phases 1A–1J |
| `Docs/11-phase2-backend-staff.md` | Staff API, sub-phases 2A–2H |
| `Docs/12-phase3-frontend-guest.md` | Guest frontend, sub-phases 3A–3H |
| `Docs/13-frontend-structure.md` | Frontend folder layout, routes, `src/lib/` module ownership |
| `Docs/14-frontend-api-map.md` | **Calling the guest API from the frontend** — exact shapes, every error branch |
| `Docs/tests-phase1.md` · `tests-phase2.md` | Named test cases, written before their code |
| `apps/Backend/CLAUDE.md` · `apps/Frontend/CLAUDE.md` | Working in that app |

## Build order

Phase 0 and **1A** done and verified. Then the remaining sub-phases, **one at a time, in
order** — 1B–1J (guest backend), 2A–2H (staff backend) — then frontend guest, frontend staff,
docs. The status table in `Docs/Implimnetation.md` is authoritative and says which is next.
1G (booking hold) is the graded hard part.

Write a sub-phase's tests before its code. **Implement what the docs specify; don't redesign
it.** A signature, route, limit or column that already exists is a decision already made — a
better idea is a question for the user.

## Standing rules

- `Docs/Product.md` wins. Our decisions refine it; they don't overrule it. A genuine
  contradiction gets raised, not resolved silently.
- **Update the doc in the same change as the behaviour.** A route without its row in the phase
  doc, a column without its entry in `01-data-model.md`, or a changed signature without
  `04-contracts.md`, is incomplete work.
- Conventions live in `00-conventions.md` only. Don't restate them elsewhere — link.
- Business limits live in `apps/Backend/src/core/policy.ts` only. Never retype one of its
  numbers into a validator (INV-59).
- Assumptions are labelled in `03-decisions.md`, never shown on a product screen as
  assumptions, never passed off as client-supplied facts.
- Nothing is reported as working, passing or deployed unless it was actually run.
- Secrets never enter the repo, the client bundle, or logs. Env names only in docs.
- The user owns all `git` and all deployment. Don't commit, push, or deploy.

## Stack

Turborepo + Bun workspaces. `apps/Backend`: Bun + Express 5 + `pg` with raw parameterised SQL
+ Zod, split into two route trees (`/api/user`, `/api/admin`) that share no HTTP code, over one
shared `src/core/`. `apps/Frontend`: Vite 8 + React 19 + TypeScript. PostgreSQL. Google Gemini
for the AI step — a deliberate deviation from the spec's Anthropic Claude, recorded with its
reason in `Docs/03-decisions.md`.

Deliberately absent, don't add: ORM, Next.js, Redis, vector DB or embeddings, document
ingestion, real payment provider, real WhatsApp or Gmail integration, microservices,
WebSockets.
