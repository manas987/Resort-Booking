# apps/Backend

Express 5 API + a separate job worker. Bun is the runtime and the test runner.

Root `CLAUDE.md` has the product and the docs map. `Docs/Implimnetation.md` says which
sub-phase is next. This file is the local rules only.

## Before you write code

1. `Docs/Implimnetation.md` — which sub-phase.
2. `Docs/10-phase1-backend-guest.md` or `11-phase2-backend-staff.md` — that sub-phase's files,
   routes, exit criteria and do-nots.
3. `Docs/tests-phase1.md` / `tests-phase2.md` — its test cases. **Write them first.**
4. `Docs/04-contracts.md` — the exact signature of everything you will call. Call from the
   written signature, never from memory.
5. `Docs/06-touch-map.md` — what else your change touches.
6. `Docs/09-test-harness.md` — before the first test file of the sub-phase.

**Do not redesign.** A signature, route, limit or column that already exists in those docs,
in `src/core/policy.ts` or in `001_init.sql` gets implemented as written. A better idea is a
question for the user, not a change you make.

## Stack rules

- **Bun as runtime**: `bun <file>`, `bun test`, `bun install`, `bunx`. Bun loads `.env` — no
  dotenv.
- **Express 5 + `pg`**, raw parameterised SQL. No ORM, query builder or repository layer.
  (`Product.md` §22 requires one checked-out `pg` client per transaction.)
- **Zod** for every request body, query and param — and separately for every AI response.
- `Bun.password` for password hashes (argon2id), not bcrypt.
- `node:crypto` `randomBytes` / `timingSafeEqual` for OTPs, refresh tokens and comparisons.
- `jose` for JWT — fixed algorithm, issuer, audience and expiry all checked.
- Read `process.env` **only** in `src/env.ts`.
- Read every business limit from `src/core/policy.ts`. Never retype one of its numbers
  (INV-59) — max rooms, max nights, horizon, quote and hold minutes, OTP parameters,
  pagination bounds, job and AI timeouts all live there.
- Read identity from `response.locals.principal`, typed in `src/types/express.d.ts`.
  `request.user` does not exist here. Never from the body, query or a header (INV-35).

## Hard rules that exist for a reason

Cite `INV-n` from `Docs/05-invariants.md` in comments rather than re-explaining these.

- **One checked-out client per transaction.** Use `withTransaction` from `src/db.ts` — a plain
  function, not middleware. The caller owns the transaction visibly. Helpers take the client
  explicitly. Never `pool.query` mid-transaction, never nest.
- **Never hold a transaction open across a network call** — no provider call, no payment wait,
  no sleep (INV-20).
- **Lock `room_day` rows `FOR UPDATE ORDER BY (room_type_id, stay_date)`** before rechecking
  availability. Same order in reservations and admin writes. Recheck *after* locking (INV-3).
- **Committed inventory is computed, never a stored counter** (INV-10).
- **The backend owns every amount.** A total, price or status from the client is ignored, not
  validated. Money is integer paise (INV-7).
- **Permissions are enforced here**, per route, from `Docs/02-permissions.md`. Hidden UI is not
  a control (INV-33). Ownership is checked on the row — a matching phone or email is not
  ownership (INV-34).
- **`audit_events` is append-only.** A database trigger enforces it; no code path updates or
  deletes it (INV-14).
- Never log a password, OTP value, token, credential or connection string (INV-53).

## Layout

Established by sub-phase 1A, which is done. Feature folders arrive with their sub-phase — the
tree routers carry a comment saying which. Mount into the existing router; never create a
parallel one.

```
migrations/      migrate.ts  001_init.sql          seeds/  run.ts  data/   (seeds: 1J)
src/
  index.ts       entry: validate config, listen, graceful shutdown
  app.ts         Express assembly, no socket (tests import this)
  router.ts      /api/user · /api/admin · system
  env.ts         Zod-validated config, only reader of process.env
  db.ts          pool, type parsers, withTransaction, PG error codes
  core/policy.ts every business limit, one frozen object
  types/         express.d.ts — the response.locals contract
  middleware/    requestId errors cors rateLimit idempotency
                 userAuth adminAuth demoOnly
  routes/
    user/        router.ts + 13 resource folders
    admin/       router.ts + 18 resource folders
    system/      health/ mock/
  core/          pricing inventory booking tokens audit jobs enquiry/
  adapters/      mockPayments messaging ai/{gemini,prompts,responseSchemas}
  jobs/          worker.ts + handlers/
tests/           helpers/ + one file per concern
```

**Two route trees that share no HTTP code.** `routes/user/` and `routes/admin/` have separate
routers, schemas, controllers and auth middleware — even where both touch the same table. The
one shared layer is `core/`, which holds the rules that must not exist twice (pricing,
inventory, booking, tokens, enquiry routing). No Express types ever enter `core/`.

A resource folder is `routes.ts` + `schema.ts` + `controllers.ts`. Omit `schema.ts` when there
is nothing to validate. No barrel `index.ts`, no base classes, no abstraction with one
implementation, no empty folders.

Trace any endpoint: `router.ts → routes/<tree>/<feature>/routes.ts → controllers.ts →
schema.ts → core/`.

Full conventions — controller reading order, naming, SQL style — in
`Docs/07-backend-structure.md`.

## Commands

```
bun run preflight  prove env before building on it
bun run dev        API with hot reload       bun run worker    job worker
bun run migrate    apply migrations          bun run seed      synthetic data
bun test           tests (needs TEST_DATABASE_URL — never the working DB)
bun run check-types
```

**There is no `lint` script in this package, on purpose.** `bun run lint` from the repo root
lints the frontend and silently skips the backend — do not read its green as a backend check.
`bun run check-types` is the gate here: `strict`, plus `noUnusedLocals` and
`noUnusedParameters`, which is what actually catches a leftover import after a file move.
