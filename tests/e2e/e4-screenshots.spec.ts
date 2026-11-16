import { test, type Page } from '@playwright/test';
import { mockAccountApi, newAccount, seedSession } from './accounts-helpers';
import {
  BOOKING_ID,
  bookingView,
  listItem,
  mockBookingsApi,
  newFakeBookings,
  OWNER_RIDE_ID,
  requestedView,
} from './booking-helpers';
import { mockPlaces, PLACES } from './rides-helpers';
import { mockSearchApi, newFakeSearch, RIDE_ID } from './search-helpers';

/**
 * Screenshots of the E4 screens for the PR (docs/screenshots/E4, dark and light). Not a test: runs only with
 * E2E_SCREENSHOTS=1 (`E2E_SCREENSHOTS=1 pnpm exec playwright test tests/e2e/e4-screenshots.spec.ts`).
 */
test.skip(!process.env.E2E_SCREENSHOTS, 'set E2E_SCREENSHOTS=1 to regenerate the E4 screenshots');

const OUT = 'docs/screenshots/E4';

async function setup(page: Page, theme: 'dark' | 'light') {
  await page.addInitScript((t) => window.localStorage.setItem('haide.theme', t), theme);
  await page.addInitScript((c) => sessionStorage.setItem('haide.search', JSON.stringify(c)), {
    from: PLACES[0],
    to: PLACES[1],
    day: new Date(Date.now() + 86_400_000).toISOString().slice(0, 10),
    time: '07:30',
    win: '30',
  });
  await page.route('**/telemetry/error', (r) => r.fulfill({ status: 204 }));
  await seedSession(page);
  await mockAccountApi(
    page,
    newAccount({
      firstName: 'Ioana',
      phoneE164: '+40721234567',
      profileComplete: true,
      consent: { upToDate: true, required: [] },
    }),
  );
  await mockPlaces(page);
  const search = newFakeSearch();
  await mockSearchApi(page, search);
  const bk = newFakeBookings();
  bk.summary = { driverPendingRequests: 2, passengerUnseenUpdates: 1, nextRide: null };
  await mockBookingsApi(page, bk);
  return bk;
}

for (const theme of ['dark', 'light'] as const) {
  test(`E4 screens, ${theme}`, async ({ page }) => {
    test.setTimeout(120_000);
    const bk = await setup(page, theme);
    const shot = (name: string, fullPage = true) =>
      page.screenshot({ path: `${OUT}/${name}-${theme}.jpg`, type: 'jpeg', quality: 82, fullPage });

    // 4.1 Request sheet
    await page.goto(`/ride/${RIDE_ID}`);
    await page.getByText('Fits your route. 150 m walk to pickup.').waitFor();
    await page.getByRole('button', { name: 'Request seat' }).click();
    await page.getByRole('dialog', { name: 'Request a seat' }).waitFor();
    await page.waitForTimeout(600);
    await shot('4.1-request-sheet', false);

    // 4.2 Booking: requested, confirmed, price dropped
    bk.booking = requestedView();
    await page.goto(`/booking/${BOOKING_ID}`);
    await page.getByText('Waiting for Radu').waitFor();
    await page.waitForTimeout(2400);
    await shot('4.2-booking-requested');
    bk.booking = bookingView();
    await page.goto(`/booking/${BOOKING_ID}`);
    await page.getByText('Radu accepted your request').waitFor();
    await page.waitForTimeout(2400);
    await shot('4.2-booking-confirmed');

    // 4.3 Cancel sheet with the late warning
    bk.booking = bookingView({
      actions: { ...(bookingView().actions as Record<string, unknown>), lateCancelIfNow: true },
    });
    await page.goto(`/booking/${BOOKING_ID}`);
    await page.getByRole('button', { name: 'Cancel booking' }).click();
    await page.getByRole('dialog', { name: 'Cancel your seat?' }).waitFor();
    await page.waitForTimeout(400);
    await shot('4.3-cancel-sheet', false);

    // 4.4 Riding list
    bk.upcoming = [
      listItem({ unseen: true, status: 'confirmed', priceBani: 260 }),
      listItem({ id: 'b-2' }),
    ];
    bk.past = [listItem({ id: 'b-3', status: 'rejected' })];
    await page.goto('/rides');
    await page
      .getByRole('link', { name: /Șelimbăr/ })
      .first()
      .waitFor();
    await shot('4.4-riding-list', false);

    // 4.5 Driver requests, then after accepting one
    await page.goto(`/driving/${OWNER_RIDE_ID}`);
    await page.getByRole('listitem', { name: 'Request from Mihai' }).waitFor();
    await page.waitForTimeout(2400);
    await shot('4.5-driver-requests');
    await page
      .getByRole('listitem', { name: 'Request from Mihai' })
      .getByRole('button', { name: 'Accept' })
      .click();
    await page.getByRole('link', { name: 'Call Mihai' }).waitFor();
    await page.waitForTimeout(600);
    await shot('4.5-driver-passengers');
  });
}
