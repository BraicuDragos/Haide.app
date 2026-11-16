import { test, type Page } from '@playwright/test';
import { mockAccountApi, newAccount, publicUser, seedSession } from './accounts-helpers';
import {
  BOOKING_ID,
  bookingView,
  DROPOFF,
  mockBookingsApi,
  newFakeBookings,
  OWNER_RIDE_ID,
  ownerRide,
  PICKUP,
} from './booking-helpers';
import { DRIVER } from './search-helpers';

/**
 * Screenshots of the E5 screens for the PR (docs/screenshots/E5, dark and light). Not a test: runs only with
 * E2E_SCREENSHOTS=1 (`E2E_SCREENSHOTS=1 pnpm exec playwright test tests/e2e/e5-screenshots.spec.ts`).
 */
test.skip(!process.env.E2E_SCREENSHOTS, 'set E2E_SCREENSHOTS=1 to regenerate the E5 screenshots');

const OUT = 'docs/screenshots/E5';
type Json = Record<string, unknown>;
const minutes = (m: number) => new Date(Date.now() + m * 60_000).toISOString();
const TOKEN = 'Zx9_Kq3LmN7pR2sT5vWb0A';

const actions = (over: Json = {}): Json => ({
  canCancel: false,
  lateCancelIfNow: false,
  canReportDriverNoShow: false,
  canMarkNoShow: false,
  canRate: false,
  canShare: false,
  show112: false,
  call112Window: null,
  ...over,
});

const paxRow = (over: Json = {}): Json => ({
  bookingId: BOOKING_ID,
  status: 'confirmed',
  passenger: publicUser({ id: 'u-1', firstName: 'Ioana' }),
  pickup: { point: PICKUP, label: 'Șelimbăr, Shopping City area' },
  dropoff: { point: DROPOFF, label: 'Zona Industrială Vest' },
  phoneE164: '+40721234567',
  priceLockedBani: 260,
  finalPriceBani: null,
  noShowBy: null,
  canMarkNoShow: false,
  canRate: false,
  rateUntil: null,
  ratingGiven: null,
  ...over,
});

const drivingRide = (over: Json = {}): Json =>
  ownerRide({
    requests: [],
    seatsBooked: 1,
    canCancel: false,
    completedAt: null,
    show112: false,
    call112Window: null,
    passengers: [paxRow()],
    ...over,
  });

async function setup(page: Page, theme: 'dark' | 'light') {
  await page.addInitScript((t) => window.localStorage.setItem('haide.theme', t), theme);
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
  const bk = newFakeBookings();
  await mockBookingsApi(page, bk);
  return bk;
}

for (const theme of ['dark', 'light'] as const) {
  test(`E5 screens, ${theme}`, async ({ page }) => {
    test.setTimeout(180_000);
    const bk = await setup(page, theme);
    const shot = (name: string, fullPage = true) =>
      page.screenshot({ path: `${OUT}/${name}-${theme}.jpg`, type: 'jpeg', quality: 82, fullPage });
    const settle = (ms = 700) => page.waitForTimeout(ms);

    // Passenger: Call 112 and the safety actions on the booking
    bk.booking = bookingView({
      departureAt: minutes(-30),
      actions: actions({
        canShare: true,
        canReportDriverNoShow: true,
        call112Window: { from: minutes(-45), until: minutes(90) },
      }),
    });
    await page.goto(`/booking/${BOOKING_ID}`);
    await page.getByRole('link', { name: 'Call 112, the emergency number' }).waitFor();
    await settle(2400);
    await shot('5.6-booking-call112');

    await page.getByRole('button', { name: 'Share trip link' }).click();
    await page.getByRole('dialog', { name: 'Share trip link' }).waitFor();
    await settle(500);
    await shot('5.5-share-sheet', false);
    await page.keyboard.press('Escape');

    await page.getByRole('button', { name: 'Driver didn’t show' }).click();
    await page.getByRole('dialog', { name: /didn’t show/ }).waitFor();
    await settle(500);
    await shot('5.4-no-show-sheet-passenger', false);
    await page.keyboard.press('Escape');

    await page.getByRole('button', { name: 'Report a problem' }).click();
    await page.getByRole('dialog', { name: /Report/ }).waitFor();
    await settle(500);
    await shot('5.2-report-sheet', false);

    // Passenger: Rate
    bk.booking = bookingView({
      status: 'completed',
      rideStatus: 'completed',
      completedAt: minutes(-60),
      price: { quotedBani: 310, lockedBani: 260, finalBani: 260, droppedFromBani: null },
      rating: { given: null, rateUntil: minutes(7 * 24 * 60 - 60) },
      actions: actions({ canRate: true }),
    });
    await page.goto(`/rate/${BOOKING_ID}`);
    await page.getByRole('heading', { name: 'Rate Radu' }).waitFor();
    await page.getByRole('radio', { name: '4 stars' }).check({ force: true });
    await page.getByRole('button', { name: 'Punctual' }).click();
    await settle();
    await shot('5.1-rate');

    // Blocked people
    await page.route('**/api/v1/me/blocks', (r) =>
      r.fulfill({ json: { items: [{ user: DRIVER, blockedAt: minutes(-60 * 24) }] } }),
    );
    await page.goto('/settings/blocked');
    await page.getByRole('button', { name: 'Unblock Radu' }).waitFor();
    await settle();
    await shot('5.3-blocked-people', false);

    // Shared trip, no account
    await page.route(`**/api/v1/share/${TOKEN}`, (r) =>
      r.fulfill({
        json: {
          departureAt: minutes(30),
          pickupEtaAt: minutes(35),
          phase: 'before',
          expiresAt: minutes(24 * 60),
          driver: { firstName: 'Radu', photoUrl: null },
          car: { make: 'Dacia', model: 'Logan', colour: 'Grey', plate: 'SB12ABC' },
          pickup: { label: 'Șelimbăr, Shopping City area' },
          dropoff: { label: 'Zona Industrială Vest' },
          route: null,
        },
      }),
    );
    await page.goto(`/s/${TOKEN}`);
    await page.getByText('SB12ABC').waitFor();
    await settle(1200);
    await shot('5.5-shared-trip');

    // Driver: during the ride, with Call 112 and Mark no-show
    bk.owner = drivingRide({
      departureAt: minutes(-20),
      show112: true,
      call112Window: { from: minutes(-35), until: minutes(100) },
      passengers: [paxRow({ canMarkNoShow: true })],
    });
    await page.goto(`/driving/${OWNER_RIDE_ID}`);
    await page.getByRole('link', { name: 'Call 112, the emergency number' }).waitFor();
    await settle(2400);
    await shot('5.7-driver-ride-day');

    await page.getByRole('button', { name: 'Mark no-show for Ioana' }).click();
    await page.getByRole('dialog', { name: 'Mark Ioana as a no-show?' }).waitFor();
    await settle(500);
    await shot('5.4-no-show-sheet-driver', false);
    await page.keyboard.press('Escape');

    // Driver: no-show marked
    bk.owner = drivingRide({
      departureAt: minutes(-20),
      passengers: [
        paxRow({ status: 'no_show', noShowBy: 'driver', phoneE164: null, priceLockedBani: null }),
      ],
    });
    await page.goto(`/driving/${OWNER_RIDE_ID}`);
    await page.getByText('You marked Ioana as a no-show.').waitFor();
    await settle(1800);
    await shot('5.4-driver-no-show');

    // Driver: finished ride, rate your passenger
    bk.owner = drivingRide({
      status: 'completed',
      departureAt: minutes(-120),
      completedAt: minutes(-60),
      passengers: [paxRow({ status: 'completed', canRate: true, rateUntil: minutes(9000) })],
    });
    await page.goto(`/driving/${OWNER_RIDE_ID}`);
    await page.getByRole('link', { name: 'Rate Ioana' }).waitFor();
    await settle(1800);
    await shot('5.1-driver-completed');

    // Suspended
    await page.route('**/api/v1/me', (r) =>
      r.fulfill({
        status: 403,
        json: { error: { code: 'ACCOUNT_SUSPENDED', message: 'x', requestId: 'r' } },
      }),
    );
    await page.goto('/rides');
    await page.getByRole('button', { name: 'Sign out' }).waitFor();
    await settle();
    await shot('5.8-suspended', false);
  });
}
