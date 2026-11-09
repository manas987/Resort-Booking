# Permissions

Resolved from `Docs/Product.md` §5–6. **Enforced on the backend, per route.** Hidden
navigation and disabled buttons are presentation, not access control.

## Principals

One `users` table. `kind` separates guests from employees; `role` and `team` grade employees.

| kind | role | team |
|---|---|---|
| `guest` | `guest` | — |
| `employee` | `staff` | `reservations` \| `sales` |
| `employee` | `gm` | null |
| `employee` | `owner` | null |

`is_active = false` blocks **every** login method and rejects existing sessions on the next
request. A guest can never self-select an employee role; Google sign-in verifies an identity
and grants nothing by itself.

## Guards

Composable middleware. A route names exactly one, plus an ownership check where relevant.

| Guard | Passes |
|---|---|
| `public` | Anyone, unauthenticated |
| `guest` | Authenticated, `kind = guest` |
| `verifiedGuest` | Authenticated guest with verified email **and** phone |
| `employee` | Any active employee |
| `gm` | Active `gm` or `owner` |
| `owner` | Active `owner` |
| `exporter` | `reservations` staff, `gm`, or `owner` — **not** `sales` |
| `ownsRecord` | The authenticated principal is the record's owner. Applied *after* the role guard |
| `assignedOrAbove` | Assignee of this enquiry, or `gm`/`owner` |

This table says **who passes**. The exported function names are fixed in `04-contracts.md`
under "Middleware — exact export names" — use those spellings and no others. `ownsRecord` and
`assignedOrAbove` are deliberately **not** middleware: they need the row, so they are a named
check inside the controller after it is loaded.

**Ownership beats role.** A guest route is never satisfied by role alone — the row's
`guest_user_id` must match the token subject. Phone or email matching a record is **not**
ownership: a verified phone number does not unlock every booking that used it, and an email or
WhatsApp thread never appears in a guest's website account even when the contact matches.

## Capability matrix

`✓` allowed · `—` denied · `own` own records only · `asgn` assigned records only

| Capability | Guest | Reservations | Sales | GM | Owner |
|---|---|---|---|---|---|
| Browse rooms, rates, availability | ✓ | ✓ | ✓ | ✓ | ✓ |
| Create booking / hold | ✓ verified | — | — | — | — |
| View bookings | own | ✓ all | ✓ all | ✓ all | ✓ all |
| Booking list & calendar views | — | ✓ | ✓ | ✓ | ✓ |
| Export bookings CSV | — | ✓ | **—** | ✓ | ✓ |
| Modify dates / room types | — | — | — | — | — |
| Cancel booking / customer refund | — | — | — | — | — |
| Submit website enquiry | ✓ | — | — | — | — |
| Read / reply in enquiry thread | own | asgn | asgn | ✓ all | ✓ all |
| Read others' employee threads | — | — | — | ✓ | ✓ |
| See Unsorted / Unassigned lanes | — | — | — | ✓ | ✓ |
| Assign / reassign any enquiry | — | — | — | ✓ | ✓ |
| Reroute / correct own assigned enquiry | — | ✓ asgn | ✓ asgn | ✓ | ✓ |
| Review, edit, explicitly send AI draft | — | ✓ asgn | ✓ asgn | ✓ | ✓ |
| Receive complaint alerts | — | — | — | ✓ | ✓ |
| Edit base price / calendar price | — | — | — | ✓ | ✓ |
| Edit base / date allotment, blackouts | — | — | — | ✓ | ✓ |
| Manage promo codes | — | — | — | ✓ | ✓ |
| Maintain approved resort information | — | — | — | ✓ | ✓ |
| Create / update / disable **staff** | — | — | — | ✓ | ✓ |
| Create / update / disable **GM** | — | — | — | **—** | ✓ |
| Create or promote to **owner** | — | — | — | — | **—** |
| Owner reports and funnels | — | — | — | — | ✓ |
| Read audit records | — | — | — | — | ✓ |
| Edit or delete audit records | — | — | — | — | **—** |

Notes on the deliberate noes:

- **Sales sees all bookings but cannot export.** §5 grants the visibility explicitly and
  withholds the export explicitly.
- **No booking mutation anywhere.** Date changes, room changes, extensions and cancellation
  are out of scope (§29) — not merely unexposed. The automatic refund of a late payment is
  payment recovery, not a cancellation feature.
- **No owner account via the API.** Owners are seed-only. GMs cannot create or promote a GM.
- **Audit is append-only for everyone, owner included.** Owner actions are audited too.
- **The last active owner cannot be disabled** — the account-management service refuses it.

## Employee accounts

Created by an owner (GM or staff) or a GM (staff only), with username, approved email, role
and team. The admin hands over the initial password out of band — there is **no** email
invitation system. Only the hash is stored; the password never reaches a log or an audit row.

Employees sign in with the issued username and password, or with Google linked to that
approved identity.

**Disabling an employee** blocks every login path, rejects live sessions, stops automatic
assignment, and moves their unresolved enquiries to Unassigned — while preserving category,
status, messages and assignment history. Resolved history stays attributed to them. If a
resolved thread later reopens and its old assignee is disabled, it stays Unassigned. Employees
are deactivated, never deleted, so historical references keep resolving.

## AI boundary

Not a role, but an access boundary enforced the same way. The model may receive only: the
current guest-visible thread, relevant approved resort information, backend-computed prices
and availability, and the one booking the backend itself verified is linked to that thread.

Never: arbitrary SQL, arbitrary booking IDs, another guest's thread or booking, internal
staff notes, credentials, owner reports, or any write, send or refund capability. A booking
reference typed into a message is a string, not authorisation — the backend checks the
thread-to-booking link before loading anything.

Prompt wording is not the boundary. Data selection and permissions are.
