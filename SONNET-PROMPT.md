# The prompt

Paste everything below the line into Claude Code at the repo root. Re-paste it verbatim after
any context reset — it is written to be resumable.

---

You are implementing the backend of this project. Everything you need is already written down.
Your job is to build it exactly as specified, prove each piece with the tests that were written
before it, and leave a record. **You are not the designer. Do not redesign anything.**

## Read these two files first, now, before anything else

1. `Docs/Implimnetation.md` — the index. It has the sub-phase status table, says which sub-phase
   is next, and lists the reading order.
2. `Docs/progress-log.md` — what has actually been finished and verified.

Phase 0 and sub-phase 1A are **done and verified**. Do not redo them. Start at the first
sub-phase the status table marks `next`.

## Before the first line of code

```bash
cd apps/Backend
bun run preflight
```

Both databases must be reachable, migrated and distinct, and one real Gemini call must answer.
If preflight fails, **stop and report its exact output**. Do not work around a credential.

## The cycle — one sub-phase at a time, in order

For each sub-phase, in this order, every time:

1. **Read its section** in `Docs/10-phase1-backend-guest.md` or `Docs/11-phase2-backend-staff.md`
   — files, route table, exit criteria, do-nots.
2. **Read its test cases** in `Docs/tests-phase1.md` or `Docs/tests-phase2.md`, and
   `Docs/09-test-harness.md` for how to write them.
3. **Read `Docs/04-contracts.md`** for the exact signature of everything you will call. Call
   from the written signature, never from memory. This is the single most common way this
   project breaks.
4. **Check `Docs/06-touch-map.md`** — what else your change touches.
5. **Write the tests first.** Every case ID listed for that sub-phase, as a real assertion
   against a real database. They will fail. That is correct.
6. **Write the code** until they pass. Cite `INV-n` from `Docs/05-invariants.md` in comments
   rather than re-explaining a rule.
7. **Run the exit criteria** in the sub-phase's `Exit.` line. All of them. Paste what you ran.
8. **Update, in the same change:** the status table in `Docs/Implimnetation.md`, an entry in
   `Docs/progress-log.md` in the format that file shows, plus `04-contracts.md` and
   `06-touch-map.md` if a signature or a caller changed.
9. **Then, and only then, start the next sub-phase.**

The order is 1B · 1C · 1D · 1E · 1F · 1G · 1H · 1I · 1J · 2A · 2B · 2C · 2D · 2E · 2F · 2G · 2H.
**1G (booking hold) is the graded hard part.** It gets the most care, not the least.

## Context

Your context will be compacted during this work, possibly several times. That is safe and
expected — the docs plus the status table plus the progress log are enough to resume from
nothing. So:

- **Hold no state in your head between sub-phases.** Write it down in step 8 before moving on.
- Never leave a sub-phase half-built to start the next one.
- After a compaction, re-read `Docs/Implimnetation.md` and `Docs/progress-log.md` and continue
  from the status table. Do not guess where you were.
- Do not read the whole `Docs/` folder. Open the one file you need.

## Rules that override your judgement

1. **Do not redesign.** If a signature, route path, limit, column, error code or guard name
   already exists in the docs, in `src/core/policy.ts` or in `001_init.sql`, implement it as
   written. Spotting a better approach is a note in your report, not a change you make.
2. **Nothing is "passing" unless you ran it.** Paste the command and its output. "Should pass",
   "tests look correct" and "verified by inspection" are failures.
3. **Never make a test pass by weakening it.** Do not skip a case, loosen an assertion, mock
   away inventory, pricing or the clock, or stub the thing under test. If a case cannot pass,
   that is a finding to report, not a test to edit. Deleting a red test is the worst possible
   outcome of this work.
4. **Never hardcode a business limit.** `src/core/policy.ts` holds every one of them.
5. **Never let an Express type into `src/core/`.** Controllers adapt HTTP to core functions;
   core never learns about HTTP.
6. **The two route trees share no HTTP code.** `src/routes/user/` and `src/routes/admin/` get
   separate routers, schemas, controllers and auth middleware. `src/middleware/` is shared
   except for `userAuth.ts` / `adminAuth.ts`.
7. **Do not touch git.** No `git add`, `commit`, `push`, `branch` or `stash`. No deploying. The
   project owner does all of it.
8. **No new dependencies** without being asked. No ORM, Redis, Next.js, WebSockets, vector DB,
   real payment provider, real email or WhatsApp integration.
9. **No secrets anywhere** — not in code, not in a doc, not in a log line, not in a test
   fixture. Never log a password, OTP value, token or connection string.
10. **Never run a destructive command against `DATABASE_URL`.** Tests use
    `TEST_DATABASE_URL` only.

## When to stop and wait

Stop, write a `BLOCKED` entry in `Docs/progress-log.md` with the exact failing output, and say
so plainly in your reply, if any of these happen:

- `bun run preflight` fails.
- A test case cannot be made to pass without weakening it.
- Two documents contradict each other, or a doc contradicts `Docs/Product.md`.
- Something the spec requires genuinely cannot be built as specified.
- You are about to do anything rules 1–10 forbid.

A run that stops cleanly at 1G with a real failure written down is a **good** outcome. A run
that reaches 2H by skipping tests is worthless, and worse than worthless because it looks
finished. If you are unsure which you are doing, stop.

## When you finish a sub-phase

Report, briefly: which sub-phase, which files, the commands you ran and their real output, and
anything you noticed but did not change. Then start the next one.

## When you finish 2H

Run the full suite and the cross-cutting checks (`X-1`…`X-10` in `tests-phase1.md`, `Y-1`…`Y-8`
in `tests-phase2.md`), then report: every sub-phase's state, the full test count passing and
failing, anything unverified and why, and every note you accumulated. Do not start phase 3.
