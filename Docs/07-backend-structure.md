# Backend structure and code conventions

Layout and style. Product rules are in `Product.md`; cross-cutting rules in
`00-conventions.md`; signatures in `04-contracts.md`.

## Two trees, one core

`src/routes/user/` and `src/routes/admin/` **share no HTTP code** — separate routers, schemas,
controllers and auth middleware. Even where both touch the same table (enquiries), each has
its own folder with its own SQL, field selection and guards.

`src/middleware/` **is** shared, with one exception: `userAuth.ts` and `adminAuth.ts` are
per-tree and must not be reused across trees. `requestId`, `errors`, `cors`, `rateLimit`,
`idempotency` and `demoOnly` are cross-cutting plumbing, not route code — one copy, used by
both. Duplicating CORS or the error envelope is a bug, not share-nothing discipline.

The one shared layer below HTTP is `src/core/`: non-HTTP business rules that both trees, the
worker and the AI pipeline call. It exists because duplicating the inventory and pricing algorithms would
put the overbooking rule in two files that must stay in sync — and "zero website overbookings"
is the graded requirement. No Express types ever enter `core/`.

Proven by grep, not by intention:

```
rg -n "^import .*routes/admin" src/routes/user   # must be empty
rg -n "^import .*routes/user"  src/routes/admin  # must be empty
rg -n "^import .*express"      src/core src/jobs # must be empty
rg -n "process\.env"           src               # only src/env.ts
find src -type d -empty                          # must be empty
```

They match **import lines**, not prose, so a comment that mentions the other tree does not
fail them. All four are clean as of 1A. If one starts failing, the fix is the import, never
the grep.

## Tree

Folders exist only once their sub-phase lands. No empty folders, no placeholder modules.

```text
apps/Backend/
  migrations/      migrate.ts  001_init.sql
  seeds/           run.ts  data/
  src/
    index.ts       entry: validate config, listen, graceful shutdown
    app.ts         Express assembly, no socket (integration tests import this)
    router.ts      /api/user → userRouter · /api/admin → adminRouter · systemRouter
    env.ts         Zod-validated config, the ONLY reader of process.env
    db.ts          pg pool, type parsers, withTransaction, PG error codes
    middleware/    requestId  errors  cors  rateLimit  idempotency
                   userAuth  adminAuth  demoOnly
    routes/
      user/        router.ts + 13 resource folders
      admin/       router.ts + 18 resource folders
      system/      router.ts + health/  mock/
    core/          pricing  inventory  booking  tokens  audit  jobs
                   enquiry/assignment  enquiry/processing
    adapters/      mockPayments  messaging  ai/{gemini,prompts,responseSchemas}
    jobs/          worker.ts + handlers/
  tests/           helpers/ + one file per concern
```

### Resource folders

Each is `routes.ts` + `schema.ts` + `controllers.ts`. A folder gets no `schema.ts` when it
validates nothing (`user/content/`, `system/health/`) — create only files with code.

| File | Responsibility | Must not contain |
|---|---|---|
| `routes.ts` | HTTP method, path, middleware chain, named controller. The feature's table of contents | SQL, business logic, inline handlers |
| `schema.ts` | Zod schemas for body/query/params and small related types | AI/provider response schemas — those live in `adapters/ai/responseSchemas.ts` |
| `controllers.ts` | Request handling, early failures, calling the work, explicit response | Transaction plumbing beyond `withTransaction`, duplicated pricing or inventory maths |

A `queries.ts` appears only where SQL is genuinely shared inside that feature. Simple SQL stays
in its controller — that is the clearest place for it.

## Controller reading order

Every controller, the same eight steps, in this order:

```ts
export const createBookingController: RequestHandler = async (request, response) => {
  // 1. validate input with the feature's schema
  const checkInput = createBookingSchema.safeParse(request.body);
  if (!checkInput.success) {
    return response.status(400).json({ error: { code: "validation_failed", ... } });
  }

  // 2. read the trusted actor that middleware put there — never from the body
  const principal = response.locals.principal;   // typed in src/types/express.d.ts

  // 3. early return on missing permission
  // 4. destructure into descriptive names
  const { checkIn, checkOut, rooms, promoCode } = checkInput.data;

  // 5-6. ownership/state checks and the mutation, under lock, in one transaction
  const booking = await withTransaction(async (client) => {
    await lockRoomDays(client, nights);        // helpers take the client explicitly
    await assertAvailable(client, { nights, requestedPerNight });
    return insertBookingHold(client, ...);
  });

  // 7. explicit response
  return response.status(201).json({ booking });
  // 8. unexpected failures reach middleware/errors.ts via next(err) or a thrown AppError
};
```

No deep nesting, no opaque ternaries, no callbacks hiding the sequence. Clear ten lines beat a
clever one-liner.

## Naming

| Kind | Pattern | Examples |
|---|---|---|
| Controller | `<verb><Noun>Controller` | `createBookingController`, `readBookingsController`, `sendEnquiryReplyController` |
| Schema | `<verb><Noun>Schema` | `createBookingSchema`, `updateEnquiryCategorySchema` |
| Router | `<tree><Feature>Router` | `userBookingsRouter`, `adminRatesRouter` |
| Core workflow | plain verb phrase | `createBookingHold`, `calculateQuote`, `processEnquiry` |
| Identifiers | explicit and typed | `bookingId`, `roomTypeId`, `actorUserId`, `targetUserId` |

Never `userid`, `Issueid`, bare `data` or `temp` when a real name exists. Ordinary typed
functions and named exports — no controller classes, base controllers, DI container,
decorators, service locator, CRUD factory or barrel exports.

## SQL

```sql
SELECT
  b.id,
  b.reference,
  b.status,
  b.total_paise
FROM bookings b
WHERE b.guest_user_id = $1
  AND b.created_at < $2
ORDER BY b.created_at DESC
LIMIT $3
```

- Parameterised values only — `$1`, `$2`, separate values array. Never interpolate a value.
- Multiline with clear clauses and indentation.
- **Explicit field lists** for accounts, bookings and anything private. No `SELECT *` there.
- Dynamic sort columns and directions come from a hardcoded allowlist map. No identifier is
  made safe by escaping — it is made safe by being one of a fixed set.
- TypeScript row types where they improve correctness. No blanket `any`, no casts to silence
  the compiler.
- No generic query builder wrapping handwritten SQL.

## Transactions

`withTransaction` from `src/db.ts` — a plain function, **not** middleware. The caller owns the
transaction visibly at the call site.

- Every statement inside uses the one checked-out client passed to the callback.
- Helpers that participate take that client as their first argument.
- Never `pool.query` partway through a client-owned transaction; never nest transactions.
- Never hold a transaction open across a payment wait, an AI call, or any network work.
- Lock `room_day` rows `FOR UPDATE ORDER BY room_type_id, stay_date` — fixed order everywhere,
  reservations and admin writes alike. Recheck state *after* the locks are held.
- Persist follow-up jobs inside the business transaction; process them after commit.
- A failure after a successful commit must not report a rollback that did not happen.

Database constraints and idempotency keys back up every application check — see
`05-invariants.md`.

## Errors

One envelope, one responder (`middleware/errors.ts`), codes from `00-conventions.md`. Throw an
`AppError` with the right code rather than hand-rolling a status. Never a copied-and-wrong
message — an invalid booking ID does not say "invalid name or description".

Safe logs carry the request ID plus feature and action. Never a password, OTP value, token,
credential, full private conversation, or personal data that is not needed. No SQL and no stack
traces to clients.

## Navigation

A developer traces any endpoint as:

```
router.ts → routes/<tree>/<feature>/routes.ts → controllers.ts
                                              → schema.ts
                                              → core/<workflow> (only if shared)
```

Comments explain a business invariant or a non-obvious reason — cite `INV-n` from
`05-invariants.md` rather than re-explaining it. Split a controllers file by real workflow
responsibility when it gets hard to navigate, not to satisfy a line limit.

## The worker

`src/jobs/worker.ts` is a separate process. It imports `core/` directly and must never start
the HTTP server, import frontend code, or call the project's own HTTP API to do internal work.
Scheduling, retries and failures stay visible — see `04-contracts.md` for the job contract.
