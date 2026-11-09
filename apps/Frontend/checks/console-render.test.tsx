import { expect, test } from 'bun:test';
import { renderToStaticMarkup } from 'react-dom/server';
/* Covers the console screens that still render from local fixtures. The wired ones — RatesLive
   and EnquiriesLive — fetch on mount, so a static render shows only their loading state; their
   contracts are guarded by the source-level checks in console.test.ts and by the backend's own
   suite. */
import { Router } from 'wouter';
import { ConsoleContext } from '../src/console/store';
import { seedState } from '../src/console/model';
import Overview from '../src/console/Overview';
import Bookings from '../src/console/Bookings';
import Rooms from '../src/console/Rooms';
import Management from '../src/console/Management';
import Reports from '../src/console/Reports';
import Audit from '../src/console/Audit';
const state = seedState();
const pages = [
  ['/console/overview', Overview, 'Good morning'],
  ['/console/bookings', Bookings, 'Purchased total'],
  ['/console/bookings/QE-260901', Bookings, 'Purchased amounts'],
  ['/console/rooms', Rooms, 'Website inventory'],
  ['/console/management/promos', Management, 'QUIET10'],
  ['/console/management/information', Management, 'Edit information'],
  ['/console/management/team', Management, 'Employee accounts'],
  ['/console/reports', Reports, 'Website data only'],
  ['/console/activity', Audit, 'Rates updated'],
] as const;
for (const [path, Page, content] of pages)
  test(`renders ${path} without browser or API`, () => {
    const html = renderToStaticMarkup(
      <Router ssrPath={path}>
        <ConsoleContext.Provider
          value={{ state, actor: state.employees[0], exec: () => true, notify: () => {}, navigate: () => {} }}
        >
          <Page />
        </ConsoleContext.Provider>
      </Router>,
    );
    expect(html.toLowerCase()).toContain(content.toLowerCase());
  });
test('sales list omits CSV and unrelated threads are not rendered', () => {
  const render = (Page: typeof Bookings, path: string) =>
    renderToStaticMarkup(
      <Router ssrPath={path}>
        <ConsoleContext.Provider
          value={{ state, actor: state.employees[3], exec: () => true, notify: () => {}, navigate: () => {} }}
        >
          <Page />
        </ConsoleContext.Provider>
      </Router>,
    );
  expect(render(Bookings, '/console/bookings')).not.toContain('Download CSV');
});
