You are implementing my internship-trial project. Act as a careful full-stack engineer and product designer.

Read this entire specification before making changes. Build the product end to end, with particular attention to reliability, correct inventory handling, data security, and usability on weak internet connections.

This document contains:
1. The original assignment.
2. The original selected client brief.
3. Our confirmed product and technical decisions.
4. Detailed behaviour and screen requirements.
5. Recommended implementation defaults.
6. Verification and submission requirements.
The original assignment and client brief are authoritative. Our confirmed decisions refine the implementation. Recommended defaults are implementation assumptions, not facts supplied by the client; record them in the TDD.

Do not invent additional business requirements. Do not silently expand scope. Do not reopen settled decisions without a concrete conflict.

I am the sole candidate. AI assistance is allowed. Do not delegate this work to additional agents.
1. ORIGINAL ASSIGNMENT

Brief — Your task

A client has sent us the brief you pick below. Build the product, end to end, with a great UI and UX.
Item	Requirement
You submit	One ZIP file with two files: your Technical Design Document (TDD) and a deployment.md
Time	7 days from when this step opens
Work	Alone


Build a small part really well instead of the whole scope badly. The “CORE BUILD” paragraph in your problem statement says which slice must work end to end.

Use AI, and use it well

AI tools are highly recommended. Use them to draft faster, test ideas, find gaps and polish your work, so that what you hand in is a more finished, specific outcome for this client and not a generic one. The judgement, the numbers and the final choices must still be yours. You will explain them in the interview.

What to do

Pick one problem statement from the ones shown to you. Then build it.

Must have
- The main flows in the brief work, on realistic sample data you create. No dead buttons.
- Frontend, backend, a database and sign-in. Use roles if the brief has more than one kind of user.
- The AI or automation part actually works, including what happens when it is wrong or unsure.
- A polished UI: a consistent design, a layout that works on a phone, and loading, empty and error states.
- Tests for the most important logic, and basic security: no secrets in the repository, validated inputs, access control.
How to submit

Put these two files in one .zip, up to 25 MB, and upload it.

File 1: Technical Design Document, PDF or Word

Include:
- The GitHub URL of your project, at the top.
- Also add the link to the live app if you deployed it.
- The architecture and why you chose it.
- The data model, the main flows and how the AI part works.
- UI and design decisions: the key screens and why they look the way they do.
- What you cut, and what you would do next.
File 2: deployment.md

Include:
- How to run it locally, step by step.
- How it is deployed, and the environment variables it needs: names only, never the values.
- Demo login details for the reviewer.
Rules
- Use only the information in the problem statement. Label every assumption in your TDD.
- Keep the commit history. We read it.
- Do not put secrets or real personal data in the repository.
- Keep the repository public until we have finished reviewing.
- You can resubmit until the deadline; we review your latest version.
What great looks like
- A product a client could try today.
- Clean, readable code with a clear structure.
- A UI that feels designed, not default.
- Honest notes about the limits.
- Extra depth, well-judged features beyond the core and careful edge cases count in your favour.
Common mistakes
- A beautiful front end with nothing behind it.
- Everything built, nothing working.
- No sample data, so the app looks empty.
- The AI part faked, or not handling mistakes.
- A TDD with no GitHub URL.
Scoring
Area	Weight
Quality of work	50%
Problem solving	30%
Communication	20%


The exact trial opening date and deadline have not been supplied in this specification. Do not infer them from the client’s seven-week project estimate.
2. ORIGINAL SELECTED CLIENT BRIEF

Selected project: Hill resort’s direct-booking website with AI enquiry routing.

Client

Company A, Chikkamagaluru, Karnataka. Coffee-estate resort with 64 rooms and 12 villas, 76 keys, and lawns for weddings and offsites. 140 staff, revenue ₹24–28 crore a year. Run by a General Manager, GM.

Today

68% of room nights come through online travel agencies at 18–22% commission; only 12% are direct. The website is a brochure with a phone number. Event enquiries arrive by email, phone, social media and the GM’s own WhatsApp. Rates live in Excel.

The problem

Assumptions: 76 keys × 365 × 62% occupancy = 17,199 room nights at ₹9,500. 68% via agencies = 11,695 nights = ₹11.11 crore, at 20% commission = ₹2.22 crore a year; moving 15% of that to direct saves ₹33.3 lakh.

Of 90 event enquiries a month, 30% wait over a day for a reply, losing about 3 events a month at ₹2 lakh contribution: 36 × ₹2 lakh = ₹72 lakh.

Total ₹1.05 crore a year.

These are the client’s problem-estimation assumptions. Do not present them as measured results from our application.

Users

Guests, the reservations and sales team, and the GM. The owner signs the deal.

The ask

“We pay agencies a fifth of every room they sell, while many guests would book direct if our site let them. I want a fast, beautiful site where guests pick dates, see real prices and pay. Every enquiry, from any channel, should land in one place and reach the right person with a reply ready.”

Must have
- Booking website: rooms with photos, availability, rate plans, prices with taxes, test-mode payment and confirmation.
- Admin for daily rates, website allotment, blackout dates and promo codes.
- One enquiry inbox for the web form, forwarded emails and WhatsApp, simulated in this build.
- AI router: classifies enquiries as room, wedding, offsite or complaint; extracts dates, guests and budget; assigns an owner and drafts a reply.
- Structured wedding and event enquiry form.
- Daily booking export for the reservation system.
Core build

Software Engineering candidates must ship this slice end to end, in about 6 to 8 screens:
- Room pages with availability and price.
- Booking with test payment.
- Rate and allotment admin.
- Enquiry inbox with AI routing.
Roles: guest and reservations staff.

AI: enquiry classification and reply draft.

Hard part: allotment control so the site never overbooks.

Mock payments, messages and outside systems, and seed from the sample data.

The rest of MUST HAVE is optional depth.

Out of scope
- Replacing the reservation system or a channel manager.
- Loyalty programme.
- Restaurant bookings.
AI or automation

AI classifies, routes and drafts replies.

When it is wrong:
- Low-confidence enquiries go to an unsorted lane the GM sees.
- Staff re-route in one click.
- Drafts are never sent automatically.
- Prices in drafts come from the rate table, not the AI.
- Complaints always alert the GM.
Constraints
- The site sells only an admin-set allotment, so it cannot overbook agency stock.
- Passport details for foreign guests’ Form C are taken at check-in, not online.
- Guest data is personal data under the DPDP Act 2023.
- Pages and photos must load fast on slow hill-station networks.
- Show GST at the rate for the tariff.
Design

The client values good, minimal design:
- Clean layouts.
- White space.
- A restrained palette.
- Clear type.
- Nothing on screen that lacks a purpose.
Design counts as much as features.

The booking site sells the experience:
- Large photos.
- A quiet layout.
- A booking flow of no more than three steps.
Budget and time

₹8 lakh, 7 weeks.

Success:
- Direct share from 12% to 20% of room nights in 12 months.
- Median first reply under 30 minutes in working hours.
- Zero website overbookings.
The client’s seven-week project estimate is separate from the candidate’s seven-day submission window.

Original sample data
Enquiry ID	Message	Expected category
ENQ-4410	Venue for my sister's wedding in Feb 2027, about 250 guests, 2 nights	Wedding
ENQ-4411	Is a villa free 14-16 Nov for 2 adults and a child?	Room booking
ENQ-4412	Team of 45 wants a January offsite with a conference hall	Corporate offsite


Preserve these original IDs and messages in the sample fixtures. If interpreting missing years or dates, preserve the original wording and record the interpretation separately.
3. CONFIRMED PROJECT DIRECTION

Build:
- A premium, minimal guest-facing resort website.
- One shared employee console with role-based navigation and permissions.
- A real backend, PostgreSQL database and authentication.
- Correct direct-booking inventory control.
- Working Claude-based enquiry processing.
- Simulated payment, external message and refund delivery.
- Synthetic sample data.
- Reviewer-ready documentation and deployment.
Include these optional-depth features because we explicitly selected them:
- Promo codes.
- Structured wedding/offsite enquiry form.
- Flexible date-range booking CSV export.
- Owner metrics and audit views.
- Employee account administration.
- Kanban/list enquiry views.
- Calendar/list booking views.
- Multiple rooms and mixed room types in one checkout.
Prioritise the complete core before polishing optional depth.

Do not interpret the approximate 6–8 core screens as permission to hide missing functionality. Our extra features create additional views; group supporting administration into tabs and detail panels to keep navigation compact.
4. CONFIRMED TECHNOLOGY STACK

Use:
- Monorepo: Bun workspaces.
- Runtime and package manager: Bun.
- Frontend: React, Vite, TypeScript.
- Backend: Express, TypeScript.
- Database: PostgreSQL.
- Database driver: pg.
- Queries: raw, parameterised SQL.
- Validation: Zod.
- AI provider: Anthropic Claude.
- Frontend hosting: Vercel.
- Backend hosting: Railway.
- Database hosting: I will provide the PostgreSQL connection string.
Do not introduce:
- An ORM.
- Next.js without explicit justification and approval.
- Microservices.
- Redis merely for convenience.
- A vector database.
- An embeddings pipeline.
- A document-upload/ingestion system.
- A separate frontend application for every employee role.
- Turborepo unless there is an actual need.
- A real payment provider.
- Real WhatsApp/Gmail integrations.
A suitable starting structure is:
- apps/web: React/Vite frontend.
- apps/api: Express API, background-worker entry point and backend logic.
- apps/api/db/migrations: numbered SQL migrations.
- apps/api/db/seeds: synthetic seed data.
- Root workspace configuration, scripts, README and environment examples.
Create shared packages only when there is actual shared code. Do not add packages just to make the repository look architectural.

Inspect existing repository instructions and files before modifying anything. Preserve unrelated work.
5. ROLES, TEAMS AND PERMISSIONS

Use these employee permission levels:
1. Staff.
2. GM.
3. Owner.
Within staff, distinguish responsibilities:
- Reservations.
- Sales.
This can be represented as a team field alongside the role. Do not create separate applications for them.

Guest

Can:
- Browse public content, rooms, rates and availability.
- Sign in or sign up.
- Book rooms after authentication and required contact verification.
- View only their own bookings.
- Submit website enquiries.
- View and reply to only their own website enquiry threads.
- Edit their own profile, subject to contact re-verification.
Cannot:
- Read another guest’s records.
- Access employee endpoints.
- Select a staff role during registration.
- Access email/WhatsApp threads through the website merely because contact details match.
Reservations staff

Can:
- See all booking records.
- See room information, prices and availability.
- Use booking list/calendar views.
- Handle assigned room enquiries.
- Read assigned conversation history.
- Review, edit and explicitly send AI drafts.
- Correct classification and reroute an incorrectly assigned enquiry.
- Export bookings as CSV.
Cannot:
- Change room prices, allotments or blackouts.
- Create employee accounts or change roles.
- Modify booking dates or room types.
- Cancel bookings or initiate customer-requested refunds.
- Read every other employee’s enquiry thread by default.
Sales staff

Can:
- See all booking records, as explicitly requested.
- See room information, prices and availability.
- Use booking list/calendar views.
- Handle assigned wedding/offsite enquiries.
- Review, edit and explicitly send AI drafts.
- Correct classification and reroute incorrectly assigned enquiries.
- Coordinate room requirements for event enquiries.
Cannot:
- Change prices, allotments or blackouts.
- Modify bookings.
- Cancel bookings.
- Refund event payments.
- Create employee accounts or change roles.
- Export bookings by default.
- Read every employee’s enquiry thread by default.
GM

Can:
- Use staff functionality.
- See all enquiries and all employee conversations.
- See unsorted and unassigned enquiries.
- Assign and reassign any enquiry.
- Handle complaints and receive complaint alerts.
- Edit base prices and calendar price overrides.
- Edit base website allotment and date overrides.
- Manage blackouts.
- Manage promo codes.
- Maintain approved resort information.
- Create, update and disable staff accounts.
- Assign staff to sales or reservations.
Cannot:
- Create/promote another GM.
- Create an owner account through ordinary account-management APIs.
- Edit or delete audit records.
- Use booking-change/cancellation features that are outside this build.
Owner

Has all GM/staff capabilities and can:
- Assign and reassign enquiries.
- Create, update and disable GM/staff accounts.
- Access owner reporting and funnels.
- Read audit records across employee actions, including owner actions.
Do not make owner actions invisible to auditing.

Prevent accidental removal of the final active owner.

Enforce all permissions on the backend. Hidden navigation and disabled buttons are not security controls.
6. EMPLOYEE ACCOUNT CREATION AND DISABLING

Account creation:
- Owner creates GM and staff accounts.
- GM creates staff accounts.
- Admin enters an employee username, approved email, role and team.
- Admin provides the initial password directly to the employee.
- Do not build an email-invitation system.
- Store only a secure password hash.
- Never include passwords in audit logs.
- Staff cannot create employee accounts or elevate their own role.
Employees can sign in using:
- Admin-issued username/password.
- Google login linked to their approved employee identity.
Google verification does not create employee privileges by itself.

When disabling an employee:
- Block access through every login method.
- Invalidate or reject existing sessions.
- Stop automatic assignment to that employee.
- Move unresolved assigned enquiries to Unassigned.
- Preserve category, conversation status, messages and assignment history.
- GM can assign those enquiries to someone else.
- Keep resolved history.
- If a resolved thread later reopens and its old assignee is disabled, leave it Unassigned.
Use active/disabled records rather than deleting employees and breaking historical references.
7. GUEST AUTHENTICATION AND CONTACT VERIFICATION

Public access:
- Guests can browse the home page, room pages, photos, prices and availability without login.
- Authentication is required before creating a booking/payment hold.
- Preserve selected rooms and dates through authentication.
- Revalidate prices and availability after login.
Guest identity:
- Email can be verified through Google authentication or email OTP.
- Phone number is verified through OTP.
- Ask for the main guest’s name.
- Prefill the name from Google when available.
- Let the guest edit the name before submission.
- Name is not an authorisation identifier.
- Phone verification must not grant access to every booking using that phone number.
Verification reuse:
- Reuse previously verified contacts while the guest remains authenticated.
- Do not demand another OTP for every booking.
- Verify a new phone/email if the guest changes it.
- Changing a contact must not silently merge accounts or transfer booking ownership.
Use JWT-based authentication as selected.

Recommended technical default:
- Short-lived access JWT.
- Rotating refresh credential stored securely.
- HTTP-only, secure cookies where deployment routing supports them correctly.
- Server-side refresh/session records for revocation.
- Backend checks account activity and permissions, including disabled employees.
- Fixed verification algorithms, issuer/audience validation and token expiry checks.
- CSRF protection where cookies authenticate mutations.
- Exact origin allowlists.
- Rate limits, especially on staff login and OTP endpoints.
Do not store long-lived authentication secrets in localStorage.

Use a maintained Google identity implementation. Validate identity server-side and associate the stable provider identity with the approved account. Do not trust an email or role sent by the browser.

Google sign-in does not grant access to Gmail.

OTP delivery

External systems may be mocked for the trial.

Implement the OTP challenge/verification logic properly:
- Expiring challenge.
- One-time use.
- Purpose binding.
- Attempt limits.
- Resend limits.
- Safe storage.
- Rate limiting.
- No universal production bypass code.
A mock OTP delivery flow does not prove ownership of a real phone/email. Make demo delivery explicit and restrict demo code exposure to synthetic reviewer identities or a safely scoped demo challenge. Never expose a general OTP inbox containing other users’ codes.
8. GUEST SCREENS

A. Home

Purpose: sell the coffee-estate experience and begin room discovery.

Include:
- Large, optimised resort photography.
- Quiet typography and restrained colours.
- Date search.
- Adults, children and room requirements.
- Clear path to browse rooms.
- Brief resort information based on approved content.
- Wedding/offsite enquiry entry point.
- Sign-in/account navigation.
Do not invent a real street address, location pin, awards, reviews or facilities not supported by supplied or explicitly synthetic content.

Avoid autoplay video, heavy animation and decorative sections that distract from booking.

B. Rooms and availability

Include:
- Date and occupancy controls.
- Available room types.
- Cover image, description, amenities and capacity.
- Clear price labels.
- Room quantities.
- Ability to combine different room types.
- Clear unavailable/sold-out states.
- Running selection summary.
- Tax-inclusive final totals when a complete quote is available.
Do not claim current availability while the API is unavailable.

If showing a base “from” price without dates, label it as such; do not present it as a final stay quote.

C. Room details

Reusable room-detail template containing:
- Photo gallery.
- Room description.
- Amenities.
- Capacity.
- Room-only inclusions.
- Date-specific availability and price.
- Quantity/occupancy selection.
- Add/select action.
- Clear route back to the overall room selection.
No physical room-number selection.

D. Booking flow

No more than three main steps:
1. Choose rooms, dates and per-room occupancy.
2. Guest details, authentication/contact verification and review.
3. Mock payment.
Confirmation is the result state.

Do not create an additional full booking step for each verification action. Integrate verification into the relevant stage.

Review must show:
- Shared check-in/checkout dates.
- Every selected room.
- Adults/children per room.
- Nightly rate breakdown.
- Promo discount.
- GST/tax breakdown.
- Grand total.
- Relevant booking terms.
- Main guest contact details.
If a price changes before the hold is accepted, show the revised quote and require acknowledgement.

E. Confirmation and My bookings

Show:
- Booking reference.
- Confirmed versus pending/failed/expired status.
- Room breakdown.
- Dates.
- Guest counts.
- Purchased prices, discount, taxes and total.
- Main guest contact.
- Payment/refund status where relevant.
- Clear support/enquiry action.
Guests can list and open only their own bookings.

No guest cancellation, date-change, extension or room-change controls.

F. My account / Open queries

Provide:
- My bookings.
- Open website enquiry threads.
- Resolved website enquiry history.
- Profile/contact information.
Guests can:
- Read staff replies.
- Reply in their website threads.
- See the enquiry status.
- Create a booking-linked enquiry from their own booking.
Do not expose staff-only notes or AI processing internals.

G. Wedding/offsite page and form

Collect:
- Event type: wedding or corporate offsite.
- Preferred dates, month or flexible period.
- Date flexibility.
- Guest count.
- Rooms needed.
- Number of nights.
- Optional budget.
- Additional requirements.
- Guest contact details.
This creates an enquiry.

It does not:
- Reserve a lawn.
- Guarantee event-space availability.
- Take a venue deposit.
- Create an event-payment workflow.
- Promise a package price that does not exist in approved information.
9. SHARED EMPLOYEE CONSOLE SCREENS

The console must feel like a polished operational tool:
- Sidebar navigation.
- Restrained colours.
- Clear tables.
- Consistent spacing.
- Good hierarchy.
- Practical filters.
- Responsive layouts.
- No excessive creative effects.
Use one application with permission-based navigation.

A. Enquiries

Provide:
- Kanban and list views of the same records.
- Search.
- Status/category/source filters.
- Assignment filters where authorised.
- Sorting.
- Unread/new activity indicators.
- Unsorted and Unassigned views for GM/owner.
- Complaint indicators.
- Conversation/detail panel.
- Extracted requirements.
- Editable AI draft.
- Explicit send action.
- Classification correction and rerouting.
- Delivery status.
- Assignment/activity history.
- Clearly separated staff-only internal notes if included.
Kanban columns are New, In progress and Resolved. Cards are not manually moved: an accepted staff reply moves the enquiry to In progress; resolving/reopening remains an explicit thread action. Unsorted/Unassigned are filters, not extra statuses. Updated by the user's 9 Nov UI revision.

Do not build a general Notion database/view/formula designer. The desired flexibility is useful Kanban/list views with shared filtering.

B. Rooms & bookings

Available to staff, GM and owner.

Provide:
- Room information and capacity.
- Current prices and availability.
- Booking list.
- Booking calendar.
- Date/search filters.
- Booking detail panel.
- Read-only purchased prices.
- Relevant guest contact details.
- Role-authorised CSV export.
No booking mutation features.

C. Rates & allotment

GM/owner only.

Provide:
- Room-type selection.
- Base nightly price.
- Base website allotment.
- Calendar date selection.
- Date-range price overrides.
- Date-range allotment overrides.
- Blackout controls.
- Preview of affected settings.
- Confirmation when replacing overlapping settings.
- Validation errors identifying conflicting dates.
- Change history.
D. Management

GM/owner only, with role restrictions within the page.

Tabs:
- Promo codes.
- Resort information.
- Employee accounts.
GM cannot manage GM/owner privileges.

E. Reports & audit

Owner only.

Provide:
- Agreed metrics and charts.
- Date-range filtering.
- Website conversion funnels.
- Audit records and filters.
- Clear definitions of financial and occupancy-like metrics.
Do not label website-only metrics as complete resort financial reporting.
10. ROOM INVENTORY MODEL

Guests book room types, not numbered rooms.

Example: “one villa for 14–16 November.”

The resort’s existing reservation system/operations assigns the physical villa.

Maintain:
- Physical room-type stock.
- Base website allotment.
- Date-specific website allotment.
- Blackouts.
- Confirmed room-night commitments.
- Active payment holds.
Sell only the website allotment.

Do not automatically treat all 76 keys as website inventory.

The website does not synchronise OTA stock. Staff must configure its allotment consistently with outside allocations.

For a stay:
- Check-in is inclusive.
- Checkout is exclusive.
- Reserve inventory for every night.
- Every selected room must fit its occupancy rules.
- Every selected room/night must be available.
The invariant is:

Confirmed inventory plus active holds must never exceed the effective website allotment for any room type/night.

Use database-level concurrency control.

JavaScript being single-threaded is not protection against overlapping database requests.

Use a short transaction:
- Materialise/access the relevant inventory records safely.
- Lock all necessary records in a consistent order.
- Recheck availability after obtaining locks.
- Create the reservation/hold atomically.
- Commit promptly.
Do not hold a database transaction or row lock open while the guest spends minutes paying.

Admin changes must use compatible locking/validation rules.
11. MULTI-ROOM BOOKING RULES

Support:
- Multiple rooms.
- Different room types in one checkout.
- Shared check-in/checkout dates.
- Separate adult/child allocation per room.
- One mock payment.
- One overall booking reference.
- Room-level detail records.
If one required room/night cannot be reserved:
- Reserve none.
- Return an understandable availability-conflict response.
- Let the guest revise the selection.
No partial successful booking hidden inside a failed checkout.

All selected rooms share the same hold expiry.

Different stay dates require separate bookings.

Occupancy:
- Each room type defines maximum adults, children and total people.
- Validate each room separately.
- Require at least one adult per room.
- No extra beds.
- No extra adult/child surcharges.
- The room price covers permitted occupancy.
- Exceeding capacity means choosing another suitable room.
Do not use spare capacity in one selected room to justify exceeding another room’s limit.
12. PRICING, ALLOTMENT AND BLACKOUT RULES

Base price

GM/owner sets a base nightly room-only price per room type.

Calendar override

GM/owner can set a special nightly price for a date range, for example festival dates.

Outside overrides, use the base price.

Do not require staff to enter a price manually for every future date.

Website allotment

Use the same default-plus-override pattern:
- Base website allotment per room type.
- Date-specific override.
- Physical stock remains separate.
Blackouts

Blackouts stop new bookings.

Existing confirmed bookings and valid payment holds remain honoured.

Safeguards
- Allotment cannot exceed physical stock.
- Allotment cannot be reduced below confirmed bookings plus active holds.
- Removing an override must also pass validation against the resulting base values.
- Changing a base allotment must check affected commitments.
- Overlapping date edits show what will be replaced and require confirmation.
- Concurrent administrative changes must not silently overwrite newer edits.
- Audit important changes.
Price snapshots

Store purchased prices, discounts, taxes and relevant terms on the booking/room-night records.

Current rate tables and audit history are not substitutes for booking snapshots.

Existing bookings must not change when:
- Base price changes.
- A festival override changes.
- A promo code changes.
- Approved resort information changes.
A valid payment hold retains the agreed quote until its expiry.

Tax and money
- Backend computes all authoritative amounts.
- Never trust frontend totals.
- Use integer paise or exact decimal arithmetic.
- Define rounding explicitly.
- Verify applicable GST using authoritative current information.
- Consider tariff thresholds and nightly pricing correctly.
- Do not invent a tax rate.
- Record tax configuration/version used in a purchased quote.
- If tax/pricing configuration is invalid, fail clearly rather than silently charging zero tax.
13. PROMO CODES

Included scope:
- GM/owner creates/manages codes.
- Percentage discount or fixed INR discount.
- Expiry.
- Usage limit.
- One code per booking.
- No stacking.
Backend must:
- Validate the code.
- Validate its dates/status.
- Calculate its discount.
- Prevent negative totals.
- Enforce usage limits under concurrency.
- Reserve/release redemption capacity consistently with payment holds.
- Prevent a repeated request from consuming multiple uses.
- Snapshot the purchased code/discount.
- Keep existing booking totals intact after later code edits.
Do not add elaborate campaign targeting, loyalty points or referral programmes.

Document whether validity is checked against booking time, stay dates or both. Use the simplest explicit rule consistent with this specification.
14. BOOKING AND MOCK-PAYMENT LIFECYCLE

There is no external payment provider in this build.

Build a server-side mock adapter that exercises real application state transitions.

Booking and payment statuses are separate.

At minimum represent:
- Pending payment.
- Confirmed.
- Payment failed.
- Expired.
Payment/refund records may additionally represent:
- Processing.
- Succeeded.
- Failed.
- Refund pending.
- Refunded.
- Refund failed.
Do not force every payment condition into one booking-status field.

Normal flow
1. Guest selects rooms.
2. Backend calculates quote.
3. Guest authenticates and verifies required contacts.
4. Guest reviews the authoritative total.
5. Backend revalidates and creates an atomic hold.
6. Mock payment attempt begins.
7. Successful payment confirms the booking transactionally.
8. Confirmation becomes available and a simulated confirmation message is recorded.
Failure
- Record failure.
- Release inventory exactly once.
- Show a recoverable outcome.
- A new attempt requires current availability and a valid hold.
Expiry
- The server controls expiry.
- Refreshing the browser does not restart the countdown.
- Expired holds no longer block inventory.
- A durable worker catches up after restarts.
- The UI recovers status from the server.
Late successful payment after inventory release

This decision is confirmed:
- Do not automatically revive/rebook.
- Record an automatic mock refund.
- Generate a simulated apology email.
- Record delivery/refund status.
- Avoid duplicate refunds or apology messages.
Idempotency

Handle:
- Double-clicks.
- Retried HTTP requests.
- Repeated mock events.
- Concurrent event processing.
- Lost responses.
- Success/expiry races.
- Failure arriving after confirmed success.
The mock ledger/event source is server-controlled. The browser cannot decide that a booking is paid by submitting a total or setting a status.

If the network drops after a write:
- Recover using the same idempotency key and/or booking status.
- Do not blindly create another booking or payment.
15. ENQUIRY SOURCES AND CHANNEL BEHAVIOUR

Sources:
- Website.
- Simulated forwarded email.
- Simulated WhatsApp.
Store original source, message, timestamps and source identifiers.

Normalise all sources into the employee inbox.

Website
- Guest sees their website enquiries in Open queries.
- Guest can read and reply in the website thread.
- Resolved website enquiries remain accessible as history.
Email and WhatsApp
- Staff replies remain on the originating channel.
- Delivery is simulated.
- Messages and delivery records remain in the database and employee view.
- Do not automatically display these threads in a guest’s website account.
- Matching phone/email alone does not grant account access to an external thread.
No real Gmail API access or WhatsApp Business integration is required.

Provide a safe way for reviewers to exercise simulated incoming and outgoing messages. Do not make unrestricted production ingestion or mock event controls publicly writable.

Persist enquiries before starting AI work.
16. ENQUIRY STATUSES, CATEGORIES AND ASSIGNMENT

Conversation statuses:
1. New: received, awaiting staff response.
2. In progress: being handled; an accepted staff reply starts this status automatically.
3. Resolved: enquiry handled, explicitly marked by staff.
The former Awaiting guest status is retired from the UI and new status writes. Existing stored
records remain compatible and appear as In progress; do not drop or hide those enquiries.
Separate fields:
- Category.
- Assignee.
- AI processing/review status.
- Source.
- Tags.
- Delivery status.
Categories:
- Room.
- Wedding.
- Offsite.
- Complaint.
Uncertain classification can remain unset/needs review rather than inventing a confident category.

Automatic routing
- Room enquiry → reservations.
- Wedding → sales.
- Offsite → sales.
- Low confidence/invalid AI result → GM-visible unsorted review.
- Complaint → GM alert.
- No available/configured assignee → Unassigned, visible to GM.
The AI suggests/extracts the category. Backend rules select an authorised active employee.

The GM does not manually approve every assignment.

GM/owner can:
- See every thread.
- Assign unassigned enquiries.
- Reassign any thread.
- Review unsorted enquiries.
Staff can correct and reroute their assigned enquiries.

For mixed event/accommodation requests, sales can own the event enquiry and coordinate room information without a separate event-booking engine.

Reopening
- Guest reply to a legacy Awaiting guest record → In progress.
- Guest reply to Resolved → In progress.
- Retain the assignee if active.
- Otherwise move to Unassigned.
Messages and notes

Keep guest-visible messages separate from internal notes.

Do not include internal notes automatically in AI context or outgoing replies.

Do not let failed delivery silently count as a successful guest response.
17. AI ARCHITECTURE — CONFIRMED HIGH-LEVEL DESIGN

Use real Claude inference.

We prioritise:
- Reliability.
- Correctness.
- Data safety.
- Security.
- Human control.
No embeddings/vector database initially.

No PDF/document ingestion.

Approved resort information is maintained through an editable GM/owner page.

Store and version approved facts such as:
- Amenities.
- Room information.
- Check-in/house policies.
- Wedding/offsite facilities and facts.
Prices and availability come from live structured database queries, not copied policy text.

Permitted AI context

Only:
- Current guest-visible enquiry thread.
- Relevant approved resort information.
- Backend-approved live prices and availability.
- The specific booking securely linked to that thread, if any.
Relevant linked-booking information can include:
- Booked room types/counts.
- Stay dates.
- Occupancy.
- Purchased amounts.
- Booking/payment status.
Do not supply unnecessary payment metadata, unrelated contact information or secrets.

A booking reference typed into a message is not authorisation.

The backend must validate the thread/booking relationship before loading it.

Forbidden access/capabilities

Claude must not have:
- Arbitrary SQL access.
- Access to arbitrary booking IDs.
- Other guests’ threads.
- Other guests’ bookings.
- Staff credentials.
- Owner reports.
- Booking/refund/write tools.
- Direct message-send permissions.
Processing

A suitable bounded pipeline:
1. Save enquiry.
2. Classify/extract using a validated schema.
3. Backend validates dates/counts and applies routing rules.
4. Backend assembles approved facts and authorised live data.
5. Generate a draft.
6. Validate the result.
7. Staff reviews/edits.
8. Staff explicitly sends.
No database transaction waits for an AI response.

Prices in drafts
- Authoritative price text comes from the rate/quote engine.
- Prefer backend-rendered quote blocks or controlled fields.
- Reject/flag invented monetary claims.
- Keep the customer’s stated budget separate from a resort offer.
- Missing event prices require human confirmation.
- A quote does not reserve rooms.
- Recheck stale price/availability information before sending a quote.
Uncertainty and failure
- Missing facts: admit uncertainty and ask for information/staff confirmation.
- Ambiguous dates: preserve the original statement and tentative interpretation.
- Low confidence: GM review.
- Malformed output: reject it.
- AI timeout/outage: keep the enquiry, show failure, allow manual handling/retry.
- Complaints: always trigger the GM alert path when identified; explicit complaint categorisation must not depend on model confidence.
- Failed/uncertain processing must be visible so potential complaints are not silently lost.
- Never send automatically.
Validation and traceability
- Zod schema validation.
- Semantic validation beyond JSON shape.
- Bounded context.
- Bounded retries and timeouts.
- Cost/request limits.
- Knowledge/prompt/model version recorded per run.
- Minimum necessary information in logs.
- No blanket storage of sensitive full prompts in general logs.
Prompt instructions alone are not the security boundary. Permissions and data selection remain outside the model.

Do not promise zero hallucinations or zero prompt-injection risk.
18. LOW-INTERNET AND IMAGE REQUIREMENTS

Weak-network usability is a real product requirement.

Gallery
- Load the first useful photo initially.
- If above the fold, load it eagerly with appropriate priority.
- Fetch other full photos when the user navigates to them.
- Do not download every hidden photo sequentially after the first.
- Keep the current image visible until the next one is ready.
- Show an understandable loading/error state.
- Reuse downloaded images through normal HTTP caching.
- Do not assume hiding an image with CSS prevents downloading.
- Avoid automatic gallery rotation.
- Optional adjacent-image prefetching must be conservative and justified by measurement.
Image delivery
- Generate responsive image variants.
- Use suitable modern formats and fallbacks.
- Use correct srcset/`sizes`.
- Specify dimensions or aspect ratio.
- Lazy-load below-fold images.
- Do not lazy-load the principal visible hero.
- Don’t send a desktop original to a small phone unnecessarily.
- Keep large originals out of the initial payload.
- Use curated, properly sourced sample photos.
- Prefer pre-generated variants over adding an expensive media platform without need.
Application loading
- Split guest, staff and reporting code.
- Guests should not download Kanban/chart/admin bundles.
- Load heavy operational views only when used.
- Avoid large date/gallery/chart packages when a small existing/native approach works.
- Avoid third-party font waterfalls.
- Avoid autoplay video, embedded maps and decorative animation on initial load.
- Keep text and key controls usable while images load.
API
- Return small, task-specific payloads.
- Paginate booking lists and conversation history.
- Don’t download every enquiry’s complete message history for the inbox.
- Cancel/ignore obsolete read requests.
- Don’t request availability for incomplete/invalid input.
- Keep booking/availability endpoints independent of AI latency.
- Use compression.
- Refresh sensibly when visible/focused rather than constantly downloading full inboxes.
Connection loss
- Preserve in-progress form state during transient errors.
- Persist non-sensitive search/cart selections where helpful.
- Do not indiscriminately store personal information or private messages in browser storage.
- Clearly distinguish “not submitted”, “submitting” and “status unknown”.
- Recover uncertain writes by status/idempotency lookup.
- Never automatically replay financial or inventory-changing requests without idempotency and explicit state checks.
- Do not claim a booking is confirmed while offline.
- Initial access still requires connectivity.
- True offline booking/payment is excluded.
Proposed performance targets

These are engineering targets, not measured results or original client requirements:
- Initial guest JavaScript approximately 120 KB compressed or less.
- First useful mobile hero approximately 100 KB or less.
- Initial above-fold transfer approximately 350 KB or less.
- No hidden full-gallery downloads on first load.
- No staff bundles in initial guest load.
Measure on:
- Cold cache.
- A constrained profile such as 1 Mbps bandwidth and 400 ms round-trip latency.
- CPU throttling.
- Connection dropouts during search, verification and payment.
Record results honestly and adjust based on evidence. Do not claim a target was met without measurement.
19. RENDERING AND CACHING DIRECTION

Our latest recommendation was:

Pre-rendered stable public content + client-rendered interactive/private flows.

This was discussed as a proposed technical direction, not a previously implemented or benchmarked result.

Use it as the preferred starting assumption if it can be implemented cleanly within React/Vite and the selected hosting.

Suggested route matrix:
Area	Preferred rendering
Stable home/marketing content	Pre-rendered HTML
Stable room presentation/photos	Pre-rendered where practical
Live availability and quotes	Fresh API-backed interactive state
Event introduction	Pre-rendered content
Event form	Interactive client-side form
Checkout	Client-side application with authenticated API
Guest account	Client-side protected data
Employee console	Client-side protected data


Important:
- A normal Vite SPA build is not automatically SSG.
- Static hosting does not mean the page content is pre-rendered.
- Select and document actual pre-rendering support.
- Do not create a large custom SSR framework.
- Do not silently switch to Next.js.
- Request-time SSR is not required initially.
- Pre-rendering does not eliminate the need to split/minimise JavaScript.
Mutable content

Choose an explicit, simple freshness strategy:
- Stable curated marketing content can be published at build time.
- Facts that must reflect GM edits immediately should come from a live public-content endpoint.
- If editable content is embedded in pre-rendered HTML, provide a real publish/rebuild/invalidation workflow.
- Do not assume a database edit updates old static HTML.
Never bake:
- Current room stock.
- Authoritative checkout prices.
- Personalised content.
- Private booking details.
into public static output.

Caching
- Long-cache fingerprinted public assets.
- Use explicit freshness/versioning for public catalogue facts.
- Keep sensitive responses out of shared/CDN caches.
- Use no-store where appropriate for auth, bookings, private threads and authoritative quote/payment state.
- Do not let stale cached availability authorise a booking.
- Server revalidation remains mandatory.
No service worker/PWA is required initially. Do not add one casually and risk caching private data or replaying stale actions.
20. OWNER METRICS AND AUDIT

Owner dashboard includes:
- Confirmed booking value over time.
- Website room nights sold.
- Website allotment utilisation.
- Median first staff reply time.
- Average enquiry resolution time.
- Booking funnel: visit → search → checkout → confirmed.
- Separate visit → enquiry-submitted conversion.
- Date-range filters.
Definitions must be explicit:
- AI draft generation is not a human response.
- Failed message delivery should not count as a completed reply.
- Show waiting/unanswered work rather than hiding it from averages.
- Define working hours for the 30-minute response target.
- Define resolution treatment for reopened threads.
- Distinguish booking confirmation date from stay dates.
- Define anonymous visit/session counting and avoid fingerprinting.
- Deduplicate conversion events.
- Do not treat active payment holds as sold nights.
- Label whether booking value includes tax.
- Do not claim profit without expenses.
- Do not claim total resort occupancy without outside-channel data.
- Do not claim the client’s direct-share target was achieved from synthetic website data.
Audit:
- Price/allotment/blackout changes.
- Promo changes.
- Employee creation/role/team/disable changes.
- Enquiry assignment and classification corrections.
- Staff-approved replies.
- Relevant booking/payment/refund transitions.
- Export actions.
- Owner actions too.
Record actor, action, target and time, with appropriate before/after information.

Never log passwords, OTP values, authentication secrets or full database connection strings.

Audit records are not editable/deletable through ordinary application actions.
21. BOOKING CSV EXPORT

Include a Download CSV action in the bookings area.

Permissions:
- Reservations staff.
- GM.
- Owner.
Support:
- From date.
- To date.
- Same date for one-day export.
Use booking confirmation date as the filter, interpreted in the resort timezone.

Include useful fields:
- Booking reference.
- Confirmation timestamp.
- Main guest contact.
- Check-in/checkout.
- Room breakdown.
- Occupancy.
- Base/room value.
- Discount.
- Tax.
- Total.
- Relevant booking/payment status.
Choose and document a stable row format suitable for multi-room bookings.

Protect spreadsheet consumers from formula-like guest text.

Log who exported which date range.

Do not build automatic reservation-system synchronisation.
22. DATA MODEL AND DATABASE REQUIREMENTS

Create a clear relational schema with migrations, constraints and indexes.

Likely entities:
- Users/employees.
- Sessions/refresh credentials.
- OTP challenges.
- Room types.
- Room photos.
- Base price/allotment configuration.
- Date-specific overrides.
- Daily inventory records.
- Quotes or authoritative quote snapshots.
- Bookings.
- Booking room allocations.
- Booking nights/price snapshots.
- Mock payment attempts/events.
- Mock refunds.
- Promo codes/redemptions.
- Enquiries.
- Enquiry messages.
- Assignments/activity.
- AI runs/drafts.
- Resort-information revisions.
- Notifications/outbox jobs.
- Audit events.
- Aggregate analytics events where needed.
Combine entities when doing so stays clear; don’t create a table just because it appears in this list.

Requirements:
- Parameterised SQL values.
- Allowlisted dynamic SQL identifiers/sort options.
- Foreign keys.
- Appropriate uniqueness constraints.
- Nonnegative/positive quantity and money checks.
- Valid date ordering.
- Valid state transitions in application logic and constraints where suitable.
- Unique idempotency/event keys.
- Indexes for ownership, dates, status, assignment and worker lookups.
Use PostgreSQL DATE for inventory/stay dates and timezone-aware timestamps for events.

Every transaction must use the same checked-out pg client.

Always release clients and roll back on failure.

Avoid holding transactions across AI/network calls.

Migrations must be versioned and recorded. Do not create/alter tables from public requests.

Seeds are separate from migrations and must not accidentally overwrite production data.
23. BACKEND CAPABILITIES

Design clear endpoints covering:
- Guest authentication and Google callbacks.
- Employee authentication.
- OTP request/verification.
- Session refresh/logout/current user.
- Public room catalogue and details.
- Availability.
- Authoritative quote creation.
- Booking/hold creation.
- Owned booking list/detail/status.
- Mock payment attempts.
- Safe payment/refund simulation.
- Website enquiry creation.
- Owned website thread/reply access.
- Staff inbox/detail/replies.
- Category corrections/rerouting.
- GM/owner assignment.
- AI retry/draft generation.
- Rate/allotment/blackout administration.
- Promo management.
- Resort-information editing.
- Employee account management.
- Booking exports.
- Owner metrics.
- Audit queries.
- Liveness/readiness.
Do not expose internal worker/migration functionality as unprotected public endpoints.

Validate request body, query and route parameters.

Use:
- Stable response/error formats.
- Appropriate status codes.
- Request-size limits.
- Pagination bounds.
- Date-range bounds.
- Request IDs.
- Safe error messages.
- No stack traces or SQL details in public errors.
24. DEPLOYMENT AND BACKGROUND WORK

Confirmed hosting:
- Vercel: frontend.
- Railway: Bun/Express backend.
- PostgreSQL: provided connection string.
For browser-to-API routing, prefer a deliberate same-origin API proxy through the frontend domain if appropriate and supported; otherwise configure the cross-origin/custom-domain approach correctly.

Verify rather than assume:
- Cookie behaviour.
- OAuth callback URLs.
- Origin validation.
- CSRF protection.
- Cache headers.
- Forwarded-proxy handling.
- HTTPS.
- Local development origins.
- Preview versus production environments.
Database credentials and AI secrets must exist only server-side.

Never put them in Vite client environment variables.

Use durable background work for:
- Expiring holds.
- AI processing.
- Simulated message delivery.
- Mock refunds.
- Recovery/retries.
A PostgreSQL-backed job/outbox approach is sufficient. No Redis requirement.

Jobs must:
- Survive backend restarts.
- Avoid duplicate effects.
- Have bounded retries/backoff.
- Recover abandoned work.
- Expose failures to the appropriate staff view/logs.
Do not rely solely on in-memory timers to preserve business state.

Provide:
- Liveness/readiness endpoints.
- Graceful shutdown.
- Database pooling/timeouts.
- Deployment migration commands.
- Safe seed commands.
- Backup/restore notes.
- Environment variable documentation.
Possible environment names include:
- DATABASE_URL
- APP_ORIGIN
- API_PUBLIC_ORIGIN
- JWT_SECRET
- GOOGLE_CLIENT_ID
- GOOGLE_CLIENT_SECRET
- GOOGLE_REDIRECT_URI
- ANTHROPIC_API_KEY
- ANTHROPIC_MODEL
- DEMO_MODE
- TEST_DATABASE_URL
Choose the actual minimal set. Document names only in deployment.md; never publish actual secrets.

I will supply database access. If required credentials are missing, continue independent implementation work and state the exact blocker. Do not fabricate successful database, Google or Claude integration.
25. RECOMMENDED DEFAULTS FOR DETAILS NOT PREVIOUSLY FINALISED

These are new implementation defaults, not client facts. Use sensible alternatives only with a documented reason.
- Resort timezone: Asia/Kolkata.
- Stay dates: check-in inclusive, checkout exclusive.
- Quote lifetime: 5 minutes before a hold.
- Payment hold: 10 minutes.
- Access JWT lifetime: approximately 15 minutes.
- Refresh session: approximately 7 days, revocable.
- OTP: 6 digits, 5-minute expiry, one use.
- OTP resend cooldown: 60 seconds.
- Maximum verification attempts per challenge: 5.
- Apply additional per-account/destination/IP rate limits.
- Default public message format: plain text.
- No enquiry attachments initially.
- Require guest authentication to submit website enquiries so thread ownership is unambiguous; allow public browsing of the event information.
- Simple staff assignment: configured active primary assignee per team; otherwise Unassigned for GM. Do not build workload optimisation.
- Default alert channel: persistent in-app notification; external delivery is simulated.
- Booking maximums and exact capacities: choose explicit bounded values and document them.
- Room categories/sample rates: synthetic, internally consistent and distinct from client-provided financial averages.
- No per-person charges.
- No extra beds.
- Seed photo assets rather than building a general upload manager unless necessary.
- No mandatory real-time WebSocket infrastructure; use a lightweight update approach with sensible visibility-aware refresh.
- Guest contact details stay read-only to ordinary staff initially; this build is not a guest-record administration system.
- Staff can reroute their assigned enquiry through permitted routing actions without receiving unrestricted access to everyone else’s threads.
For child-age classifications, stay limits, sample capacities and check-in/out times, choose simple explicit policies and document them. Do not present them as supplied resort facts.

GST is not an arbitrary default: verify it.

The exact AI model must be selected from currently available supported models, with cost/latency/reliability justification. Do not invent a model identifier.
26. SAMPLE DATA AND DEMO QUALITY

Preserve the three supplied enquiry fixtures exactly.

Add synthetic records covering:
- All roles.
- Sales and reservations staff.
- Unassigned enquiry.
- Unsorted/low-confidence enquiry.
- Complaint.
- AI failure.
- Resolved thread that reopens.
- Disabled employee reassignment.
- Different room types.
- Ordinary and festival pricing.
- Blackouts.
- Sold-out night.
- Multi-night price differences.
- Mixed-room booking.
- Confirmed booking.
- Failed payment.
- Expired hold.
- Late successful payment and mock refund.
- Promo-code application and usage limit.
- Date-range export.
- Dashboard events.
Use fictional people and safe demo credentials.

Do not commit real guest details.

Do not change the original sample enquiry text to make AI processing easier.

Preserve ambiguous wording and record any inferred dates as tentative where appropriate.

A message asking for a 250-person wedding does not prove the resort can host 250 people. A request for a conference hall does not prove one exists.

Reviewer flows should not depend on the database being empty.

Clearly distinguish demo outcomes from real commercial results.
27. REQUIRED TESTS AND VERIFICATION

The original assignment requires important-logic tests.

The previous planning assistant was not responsible for writing them; that does not waive the requirement. You, as implementation agent, must provide them.

Use Bun’s built-in testing where suitable. Add additional tooling only where justified.

Use an isolated test database/schema. Never wipe the supplied working database or run destructive tests against production.

At minimum verify:
1. Concurrent attempts for the last room cannot oversell.
2. Mixed-room/multi-night reservation is atomic.
3. A missing night causes full rollback.
4. Expired holds stop blocking inventory.
5. Success/expiry races preserve inventory/payment consistency.
6. Duplicate events cannot double-confirm or double-refund.
7. Lost-response retries do not create duplicate bookings.
8. Confirmed bookings retain original prices after admin edits.
9. Valid holds retain their accepted prices.
10. Allotment cannot drop below commitments.
11. Blackouts preserve existing commitments.
12. Promo usage caps hold under concurrency.
13. Guests cannot access another guest’s booking/thread.
14. Staff cannot call GM/owner administration APIs.
15. Disabled employees cannot authenticate or keep using sessions.
16. Google/OTP flows cannot elevate a guest into staff.
17. Uncertain/malformed AI output routes to review.
18. AI cannot retrieve an unrelated booking.
19. Invented prices are rejected/flagged.
20. Staff approval is required before a draft becomes a sent message.
21. External-channel threads do not leak into guest website accounts.
22. Export permissions and spreadsheet-safe text work.
23. Background jobs recover safely after restart.
Also verify:
- Mobile layouts.
- Keyboard interaction.
- Slow network.
- Image request waterfall.
- No guest download of staff bundles.
- Loading/empty/error/expired states.
- Production Google/auth routing.
- Production persistence.
- Actual Claude call behaviour.
- No secrets in repository/client bundles/logs.
Do not report tests or performance checks as passed unless actually run.
28. UI AND DESIGN STANDARDS

Guest experience:
- Premium and calm.
- Large but optimised photographs.
- White space.
- Restrained palette.
- Clear typography.
- Strong mobile layout.
- Obvious primary action.
- Clear, honest price breakdown.
- Minimal booking friction.
Employee experience:
- Clean, premium and practical.
- Sidebar.
- Readable data.
- Useful filters.
- Consistent spacing and hierarchy.
- Moderate density.
- No gratuitous animation.
- No decorative dashboard cards without operational purpose.
Accessibility:
- Visible labels.
- Keyboard operation.
- Focus states.
- Sufficient contrast.
- Accessible validation messages.
- Screen-reader-friendly status updates.
- Useful alternative text.
- Touch-friendly controls.
- No information conveyed only by colour.
No dead buttons, fake menus or controls that do nothing.

Do not put “assumption” labels on normal product screens. Assumptions belong in the TDD. Explicit test/demo payment indicators are still necessary to avoid misleading users.
29. EXPLICITLY EXCLUDED OR DEFERRED

Do not implement these in the initial build:
- Replacement hotel reservation system.
- Channel manager.
- Live OTA inventory integration.
- Physical room-number assignment.
- Restaurant bookings.
- Breakfast/meal packages.
- Loyalty programme.
- Extra beds.
- Per-person surcharges.
- Guest/staff booking extensions.
- Date changes.
- Room changes.
- Guest/staff cancellation workflow.
- Configurable cancellation/refund policy engine.
- GM discretionary cancellation-refund overrides.
- Venue/event booking engine.
- Wedding/offsite deposits or payments.
- Real payment processing.
- Real email/SMS/WhatsApp delivery.
- General-purpose CRM.
- Notion-style custom database/view builder.
- Outbound marketing campaigns.
- Document ingestion.
- Embeddings/vector database.
- Offline booking or payment.
Earlier planning discussed versioned cancellation policies and GM-only wedding/offsite refunds. Those were deliberately deferred. Do not accidentally implement them because they appeared in older notes.

Automatic mock refund of a late payment is still included as payment recovery; it is not a customer cancellation feature.
30. IMPLEMENTATION ORDER

Use this order:
1. Inspect repository and instructions.
2. Set up the minimal monorepo, environment validation, database migrations and seeds.
3. Implement authentication and server-enforced permissions.
4. Implement room catalogue and pricing/inventory logic.
5. Prove atomic reservation and payment lifecycle with important tests.
6. Complete the guest booking flow.
7. Implement enquiries, channel simulation and assignments.
8. Integrate real Claude classification/extraction/drafting with safe fallbacks.
9. Complete staff/GM screens.
10. Add promo codes, event form and export.
11. Add owner metrics/audit.
12. Implement rendering/image/network optimisation.
13. Verify deployed flows and failure states.
14. Produce final documentation and submission package.
Keep authentic, understandable commits as work progresses.

Do not fabricate a retrospective commit history.

If scope/time becomes constrained, protect the core, security and correctness first. Explain optional cuts honestly rather than leaving fake or broken features.

Ask me only for blocking credentials, unavailable external setup or genuine product conflicts. Choose routine implementation details yourself and document them.
31. FINAL DOCUMENTATION AND SUBMISSION

Produce:

Technical Design Document: PDF or Word

At the top:
- Actual public GitHub repository URL.
- Actual live app URL if deployed.
Include:
- Problem and selected core.
- Architecture and reasons for stack choices.
- Monorepo structure.
- Deployment architecture.
- Roles and permissions.
- Data model.
- Booking/inventory concurrency design.
- Payment/expiry/refund state handling.
- Price/tax/promo snapshots.
- Enquiry flow.
- AI context, validation, permissions and fallbacks.
- Rendering and caching strategy.
- Low-network image/loading decisions.
- Main screens and design rationale.
- Tests/evaluation and actual results.
- All assumptions.
- Limits, cuts and future work.
- Honest distinction between mocks and real integrations.
deployment.md

Include:
- Prerequisites.
- Exact installation steps.
- Environment variable names only.
- Database migration and seed steps.
- Local frontend/backend/worker commands.
- Test commands.
- Vercel deployment steps.
- Railway deployment/worker steps.
- Google callback setup.
- AI configuration.
- Database connection requirements.
- Safe reviewer demo accounts.
- How to exercise mock OTP/payment/message flows.
- Known deployment limitations.
Submission ZIP
- At most 25 MB.
- Exactly two files:
  - TDD PDF or Word.
  - deployment.md.
- Do not put the repository, secrets, node_modules or unrelated files in the ZIP.
- Keep repository public during review.
- Preserve commit history.
Do not invent repository/live URLs or claim deployment success before verification.
32. DEFINITION OF DONE

A reviewer can, without your help:
- Browse the resort on a phone.
- Select dates and multiple room types.
- Understand the final price and tax.
- Authenticate and complete the demo verification flow.
- Complete mock payment.
- See a persistent confirmed booking.
- Observe honest failure/expiry behaviour.
- Submit a website enquiry and read a staff reply.
- Exercise simulated email/WhatsApp enquiries.
- Sign in as staff and handle an assigned enquiry.
- See actual AI classification/extraction/drafting.
- Correct and reroute an AI mistake.
- See an uncertain enquiry in GM review.
- See a complaint alert.
- Change base/calendar rates and allotment as GM.
- Confirm existing booking prices remain unchanged.
- Apply a promo code.
- Submit an event enquiry.
- Export bookings for a date range.
- View correctly labelled owner metrics and audit records.
- Run meaningful tests.
- Follow deployment instructions.
The code must be understandable enough that I can explain the important decisions in an interview.

Do not claim the product is secure, reliable or complete merely because the architecture sounds correct. Demonstrate behaviour, record evidence and state remaining limitations.
33. REFERENCES FOR IMPLEMENTATION VERIFICATION

Use current official documentation when choosing implementation details:
- Vite SSR and SSG: https://vite.dev/guide/ssr.html
- Browser image lazy loading: https://web.dev/articles/browser-level-image-lazy-loading
- Fetch priority: https://web.dev/articles/fetch-priority
- Responsive image attributes: https://developer.mozilla.org/en-US/docs/Web/HTML/Reference/Elements/img
- Vercel rewrites: https://vercel.com/docs/routing/rewrites
- PostgreSQL locking: https://www.postgresql.org/docs/current/explicit-locking.html
- Google OpenID Connect: https://developers.google.com/identity/openid-connect/openid-connect
- OWASP authorisation: https://cheatsheetseries.owasp.org/cheatsheets/Authorization_Cheat_Sheet.html
- OWASP prompt-injection prevention: https://cheatsheetseries.owasp.org/cheatsheets/LLM_Prompt_Injection_Prevention_Cheat_Sheet.html
- Claude hallucination reduction: https://platform.claude.com/docs/en/test-and-evaluate/strengthen-guardrails/reduce-hallucinations
Verify applicable GST against authoritative current government information. Do not take a tax percentage from this prompt, an AI guess or an outdated blog.

Start by checking this specification for actual contradictions, inspecting the repository, and identifying only genuinely blocking inputs. Then proceed with implementation in the order above.

END PROMPT
- Open items carried into the handoff: verified GST, exact synthetic defaults, model/tooling choices, credentials and deployment checks. No application was implemented or tested in this planning chat.
