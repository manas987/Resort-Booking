import { expect, test } from 'bun:test';
import { renderToStaticMarkup } from 'react-dom/server';
/* Every console screen must render on the server without a browser or an API.
   All of them now fetch on mount, so a static render reaches the screen's LOADING state — and
   asserting that loading line is what proves the screen reads the API rather than a fixture.
   Their data contracts are guarded by the source-level checks in console.test.ts and by the
   backend's own suite. */
import { Router } from 'wouter';
import { ConsoleContext } from '../src/console/store';
import { canExportRole } from '../src/console/model';
import Overview from '../src/console/Overview';
import Bookings from '../src/console/Bookings';
import Rooms from '../src/console/Rooms';
import Management from '../src/console/Management';
import Reports from '../src/console/Reports';
import Audit from '../src/console/Audit';
const pages = [
  ['/console/overview', Overview, 'Loading your overview'],
  // Wired to GET /admin/bookings — a static render stops at the loading line, by design.
  ['/console/bookings', Bookings, 'Loading bookings'],
  ['/console/bookings/QE-260901', Bookings, 'Loading bookings'],
  ['/console/rooms', Rooms, 'Loading website inventory'], // wired to /rooms + /bookingCalendar
  // Wired to /promos, /staff and /resortInfo — a static render stops at the loading line.
  ['/console/management/promos', Management, 'Loading management data'],
  ['/console/management/information', Management, 'Loading management data'],
  ['/console/management/team', Management, 'Employee accounts'], // tab label, always rendered
  ['/console/reports', Reports, 'Website data only'], // wired to /reports/* — heading is static
  // Wired to GET /audit — a static render stops at the loading line, by design.
  ['/console/activity', Audit, 'Loading the activity log'],
] as const;
for (const [path, Page, content] of pages)
  test(`renders ${path} without browser or API`, () => {
    const html = renderToStaticMarkup(
      <Router ssrPath={path}>
        <ConsoleContext.Provider value={{ notify: () => {}, navigate: () => {} }}>
          <Page />
        </ConsoleContext.Provider>
      </Router>,
    );
    expect(html.toLowerCase()).toContain(content.toLowerCase());
  });
/* Sales must never see the export control (INV-37). Asserted on the predicate itself rather
   than on rendered HTML: the screen now reads the signed-in principal from the staff session,
   which is absent in a static render, so a markup assertion would pass whatever the rule said. */
test('only reservations, gm and owner may export — never sales (INV-37)', () => {
  expect(canExportRole('staff', 'reservations')).toBe(true);
  expect(canExportRole('gm', null)).toBe(true);
  expect(canExportRole('owner', null)).toBe(true);
  expect(canExportRole('staff', 'sales')).toBe(false);
  expect(canExportRole('staff', null)).toBe(false);
});
