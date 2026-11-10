# Local browser verification - 10 Nov 2026

Target: localhost:5173, with the running API, PostgreSQL and separate worker. This was not a
verification of a hosted Vercel/Railway deployment. Only synthetic reviewer accounts were used.

## Reproduced and fixed

- Payment confirmation used the reference in a UUID route. Successful payment and duplicate
  quote recovery now link with the booking ID; the reference stays visible to guests.
- Checkout rejected the documented all-zero reviewer phone. It now uses the same ten-digit
  input rule as phone verification. Checkout and account profile prefill the existing name;
  checkout also prefills the guest's own contact details without overwriting manual edits.
- Shared dropdown/calendar portals opened behind native modal drawers. Portals now mount
  inside the open native dialog, so both controls work in the edit panel.
- Legacy CSS hid the enquiry triage rail below a very wide breakpoint. Assignment, category
  correction and resolution controls are now visible on normal laptops and stacked on phones.
- Inventory previews silently ignored server conflicts. They now show the affected dates and
  disable confirmation. Backend checks remain authoritative; no conflicting change was saved.
- The booking-calendar month heading truncated the first letter. It now removes the day prefix
  without assuming its length.
- A decline keeps the booking hold pending. Polls now include the latest attempt status, show
  decline promptly, and clear the payment key while preserving the live booking key for retry.
  Expired-quote refresh also leaves a visible explanation rather than appearing to do nothing.
- The availability calendar requested past days and omitted the final displayed night. Requests
  now start no earlier than resort-local today and use an exclusive end after the final month.
- A relative seed blackout could land on the fixed festival booking (reproduced on 10 Nov).
  Blackout dates now avoid that window; festival checkout is calculated from its exact arrival.

## Browser observations

- Home dates -> room selection -> live quote -> email OTP -> restored checkout -> mock payment
  -> confirmation. One repaired success was BK-V2E6D662.
- Promo WELCOME10 -> declined attempt -> visible failure -> successful retry: BK-CSZP7F8T,
  total INR 30,798. The integration regression proves one hold with two payment attempts.
- Booking-linked enquiry ENQ-5775 appeared in the guest account and staff inbox. Real AI
  classified it as room, assigned reservations and drafted the approved check-in time. A human
  send moved it into progress; the guest could read the delivered response.
- Owner overview, activity log, bookings/list/calendar, rates/preview/history access, rooms,
  management information/team/promos, reports and enquiry list/board/detail were opened.
- Reservations cannot open Reports. Sales can open bookings without a CSV export action.
  GM navigation includes management and excludes owner reports/activity. All four demo logins worked.
- Room details, gallery next/close, availability and the help popup worked at a 390px viewport
  without horizontal page overflow. Map expanded/collapsed and its zoom control worked.
- Initial remote-photo loading was transient; later home/room checks had no broken loaded images.

## Verification and limits

Backend types and full suite: 333 passed, 10 opt-in live-provider cases skipped, no failures.
Frontend types, lint, check scripts, 51 tests and production build passed. The existing Mapbox
chunk-size and ineffective dynamic-import build warnings remain.

No fresh real Google-provider sign-in, external OTP delivery, hosted-cookie configuration,
load test, exhaustive security audit or physical-device testing was performed. External delivery
and payments remain mocks. There is still no app-wide render error boundary. Synthetic bookings
and the support thread created during the walkthrough remain in the application database.

No commits, pushes or deployment were performed by this browser-verification task.
