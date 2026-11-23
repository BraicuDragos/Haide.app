import { expect, test } from '@playwright/test';
import { pickDay, pickTime } from './time-helpers';
import { mockAccountApi, seedSession } from './accounts-helpers';
import { BOOKING_ID, bookingView, mockBookingsApi, newFakeBookings } from './booking-helpers';
import {
  mockLiquidityApi,
  newFakeLiquidity,
  rideAlert,
  seriesOwnerRide,
  stubPush,
} from './e8-helpers';
import { mockPlaces, mockRidesApi, newFakeRides, PLACES, readyDriver } from './rides-helpers';
import { mockSearchApi, newFakeSearch, publicRide, RIDE_ID } from './search-helpers';

/**
 * Screenshots of the E8 screens for the PR (docs/screenshots/E8, dark and light, 360x800). Not a test: runs only with
 * E2E_SCREENSHOTS=1 (`E2E_SCREENSHOTS=1 pnpm exec playwright test tests/e2e/e8-screenshots.spec.ts`).
 */
test.skip(!process.env.E2E_SCREENSHOTS, 'set E2E_SCREENSHOTS=1 to regenerate the E8 screenshots');

const OUT = 'docs/screenshots/E8';
const day = (n: number) => new Date(Date.now() + n * 86_400_000).toISOString().slice(0, 10);

for (const theme of ['dark', 'light'] as const) {
  test(`E8 screens at 360, ${theme}`, async ({ page }) => {
    test.setTimeout(180_000);
    const shot = (name: string, fullPage = true) =>
      page.screenshot({ path: `${OUT}/${name}-${theme}.jpg`, type: 'jpeg', quality: 82, fullPage });
    const settle = (ms = 500) => page.waitForTimeout(ms);

    await page.addInitScript((t) => localStorage.setItem('haide.theme', t), theme);
    await page.addInitScript(
      (c) => {
        try {
          if (!sessionStorage.getItem('haide.search'))
            sessionStorage.setItem('haide.search', JSON.stringify(c));
        } catch {
          /* ignore */
        }
      },
      { from: PLACES[0], to: PLACES[1], day: day(1), time: '07:30', win: '30' },
    );
    await stubPush(page);
    await page.route('**/telemetry/error', (r) => r.fulfill({ status: 204 }));
    const rides = newFakeRides();
    const fake = newFakeLiquidity({
      rides,
      alerts: [
        rideAlert(),
        rideAlert({
          id: 'a1a1a1a1-0000-4000-8000-000000000009',
          schedule: { kind: 'date', date: day(3) },
          time: '17:45',
          windowMin: 60,
          fromLabel: 'Piața Mare',
          toLabel: 'Șelimbăr',
        }),
      ],
      month: { driver: 4200, passenger: 0 },
      skip: [{ index: 0, code: 'DAILY_RIDE_LIMIT' }],
    });
    await seedSession(page);
    await mockAccountApi(page, readyDriver());
    await mockPlaces(page);
    await mockRidesApi(page, rides);
    const search = newFakeSearch();
    search.ride = publicRide({ autoAccept: true });
    await mockSearchApi(page, search);
    const bk = newFakeBookings();
    await mockBookingsApi(page, bk);
    await mockLiquidityApi(page, fake);
    await page.route('**/api/v1/bookings', async (route) => {
      if (route.request().method() !== 'POST') return route.fallback();
      bk.booking = bookingView({ autoConfirmed: true });
      return route.fulfill({ status: 201, json: bk.booking });
    });

    // 8.1 Publish form: repeat on weekdays + auto-accept
    await page.goto('/offer');
    await page.getByRole('button', { name: /^From/ }).click();
    await page.getByRole('dialog').getByRole('searchbox').fill('selimbar');
    await page.getByRole('dialog').getByRole('listitem').first().getByRole('button').click();
    await page.getByRole('button', { name: /^To/ }).click();
    await page.getByRole('dialog').getByRole('searchbox').fill('zona');
    await page.getByRole('dialog').getByRole('listitem').first().getByRole('button').click();
    await page.getByText('9.6 km, about 17 min').waitFor();
    await pickDay(page, 'Day', 'Tomorrow');
    await pickTime(page, 'Leaving at', '07:30');
    await page.getByRole('switch', { name: 'Confirm requests automatically' }).check();
    await page.getByRole('switch', { name: 'Repeat on weekdays' }).check();
    await pickDay(page, 'Until', day(21));
    await settle();
    await page.getByRole('switch', { name: 'Repeat on weekdays' }).scrollIntoViewIfNeeded();
    await shot('8.1-publish-repeat');

    // 8.2 Done screen with a skipped date
    await page.getByRole('button', { name: 'Publish rides' }).click();
    await page.getByRole('heading', { level: 2, name: 'Some days were skipped' }).waitFor();
    // The pre-prompt rides on the first publish; close it for this shot, and forget the snooze for 8.5.
    await page.getByRole('dialog', { name: 'Get updates on your phone?' }).waitFor();
    await page.getByRole('button', { name: 'Not now' }).click();
    await page.evaluate(() => localStorage.removeItem('haide.pushPrompt'));
    await settle(900);
    await shot('8.2-series-done');

    // 8.3 Driver ride: switch + series chip, cancel sheet
    const ride = '10000000-0000-4000-8000-000000000050';
    rides.rides.push(
      seriesOwnerRide(ride, new Date(Date.now() + 86_400_000).toISOString(), {
        id: 'c0c0c0c0-0000-4000-8000-000000000001',
        weekdays: [1, 3],
        departureTime: '07:30',
        startsOn: day(1),
        endsOn: day(21),
        status: 'active',
        upcomingCount: 6,
      }),
    );
    await page.goto(`/driving/${ride}`);
    await page.getByRole('switch', { name: 'Confirm requests automatically' }).check();
    await settle();
    await shot('8.3-driver-ride');
    await page.getByRole('button', { name: 'Cancel ride' }).click();
    await page
      .getByRole('dialog')
      .getByRole('radio', { name: /all later rides/ })
      .check();
    await settle(400);
    await shot('8.3-cancel-series-sheet', false);

    // 8.4 Instant confirmation: ride detail, then the booked state with the push pre-prompt
    await page.goto(`/ride/${RIDE_ID}`);
    await page.getByText('Instant confirmation').waitFor();
    await settle();
    await shot('8.4-ride-instant', false);
    await page.getByRole('button', { name: 'Request seat' }).click();
    await page.getByRole('dialog', { name: 'Request a seat' }).waitFor();
    await page
      .getByRole('dialog', { name: 'Request a seat' })
      .getByRole('button', { name: 'Send request' })
      .click();
    await page.waitForURL(new RegExp(`/booking/${BOOKING_ID}$`), { timeout: 15_000 });
    const prompt = page.getByRole('dialog', { name: 'Get updates on your phone?' });
    await prompt.waitFor();
    await settle(600);
    await shot('8.5-push-prompt', false);
    await prompt.getByRole('button', { name: 'Not now' }).click();
    await page.getByText('You’re booked').waitFor();
    await settle();
    await shot('8.4-booked-instant', false);

    // 8.6 Notify me: empty results, sheet, saved list
    search.items = [];
    search.nearest = [];
    await page.goto('/results');
    await page.getByRole('heading', { level: 1, name: 'No rides found' }).waitFor();
    await settle();
    await shot('8.6-empty-notify', false);
    await page.getByRole('button', { name: 'Notify me about this route' }).click();
    await page.getByRole('dialog', { name: 'Notify me about this route' }).waitFor();
    await settle(600);
    await shot('8.6-notify-sheet', false);
    await page.getByRole('button', { name: 'Close' }).click();
    await page.goto('/settings/alerts');
    await page.getByRole('heading', { level: 1, name: 'Ride alerts' }).waitFor();
    await settle();
    await shot('8.7-alerts-list');

    // 8.8 Settings: notifications group and the monthly line
    await page.goto('/profile');
    await page.getByText(/This month you shared/).waitFor();
    await page.getByRole('switch', { name: 'Notifications on this device' }).waitFor();
    await settle();
    await shot('8.8-settings-notifications');
    await expect(page.getByText('This month you shared 42.00 RON of fuel costs')).toBeVisible();
  });
}
