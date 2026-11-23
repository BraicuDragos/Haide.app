import { readdirSync, readFileSync } from 'node:fs';
import { gzipSync } from 'node:zlib';
import { expect, test, type Page } from '@playwright/test';
import { pickTime } from './time-helpers';
import { expectNoAxeViolations, mockAccountApi, newAccount, seedSession } from './accounts-helpers';
import { bookingView, mockBookingsApi, newFakeBookings, BOOKING_ID } from './booking-helpers';
import {
  mockLiquidityApi,
  newFakeLiquidity,
  rideAlert,
  seriesOwnerRide,
  stubPush,
  type FakeLiquidity,
} from './e8-helpers';
import {
  mockPlaces,
  mockRidesApi,
  newFakeRides,
  PLACES,
  readyDriver,
  type FakeRides,
} from './rides-helpers';
import { mockSearchApi, newFakeSearch, publicRide, RIDE_ID, tripBItem } from './search-helpers';

// E8 (liquidity boosters), web side. The API is mocked: series creation, the 4-per-day limit, alert matching, auto-accept
// and push delivery are covered by the backend unit, pgTAP and integration suites. These specs check what the person
// sees and does at 360x800: repeat on weekdays, auto-accept, Notify me and the alert list, the push opt-in, the
// monthly line, in dark and light.

const heading = (page: Page, name: string | RegExp, level = 1) =>
  page.getByRole('heading', { level, name });

const dayOffset = (n: number) => new Date(Date.now() + n * 86_400_000).toISOString().slice(0, 10);

interface World {
  fake: FakeLiquidity;
  rides: FakeRides;
}

async function setup(
  page: Page,
  opts: { theme?: 'dark' | 'light'; liquidity?: Partial<FakeLiquidity> } = {},
): Promise<World> {
  await page.addInitScript(
    (t) => window.localStorage.setItem('haide.theme', t),
    opts.theme ?? 'dark',
  );
  await page.route('**/telemetry/error', (r) => r.fulfill({ status: 204 }));
  const rides = newFakeRides();
  const fake = newFakeLiquidity({ rides, ...opts.liquidity });
  await seedSession(page);
  await mockAccountApi(page, readyDriver());
  await mockPlaces(page);
  await mockRidesApi(page, rides);
  await mockLiquidityApi(page, fake);
  return { fake, rides };
}

async function seedSearch(page: Page) {
  await page.addInitScript(
    (criteria) => {
      try {
        if (!sessionStorage.getItem('haide.search'))
          sessionStorage.setItem('haide.search', JSON.stringify(criteria));
      } catch {
        /* ignore */
      }
    },
    { from: PLACES[0], to: PLACES[1], day: dayOffset(1), time: '07:30', win: '30' },
  );
}

async function pickPlace(page: Page, which: 'From' | 'To', query: string, name: string) {
  await page.getByRole('button', { name: new RegExp(`^${which}`) }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByRole('searchbox').fill(query);
  await expect(dialog.getByRole('heading', { name: /places? found/ })).toBeVisible();
  await dialog.getByRole('listitem').first().getByRole('button').click();
  await expect(dialog).toBeHidden();
  await expect(page.getByRole('button', { name: `${which} ${name}` })).toBeVisible();
}

async function chooseTripBTomorrow(page: Page) {
  await pickPlace(page, 'From', 'selimbar', 'Șelimbăr');
  await pickPlace(page, 'To', 'zona', 'Zona Industrială Vest');
  await expect(page.getByText('9.6 km, about 17 min')).toBeVisible();
  await page.getByLabel('Day', { exact: true }).selectOption({ label: 'Tomorrow' });
  await pickTime(page, 'Leaving at', '07:30');
}

test.describe('repeat on weekdays (E8-1)', () => {
  test('the switch reveals weekdays, Until and a live count; the done screen lists the skipped date', async ({
    page,
  }) => {
    test.slow();
    const { fake } = await setup(page, {
      liquidity: { skip: [{ index: 0, code: 'DAILY_RIDE_LIMIT' }] },
    });
    await page.goto('/offer');
    await chooseTripBTomorrow(page);

    const repeat = page.getByRole('switch', { name: 'Repeat on weekdays' });
    await expect(repeat).toBeEnabled();
    await expect(page.getByText('Coming soon')).toHaveCount(0);
    await repeat.check();

    // The weekday of the chosen day is on already; the live line follows the choices.
    const on = page.getByRole('button', { pressed: true });
    await expect(on).toHaveCount(1);
    const pressed = page.getByRole('button', { name: (await on.textContent())!, exact: true });
    await page.getByLabel('Until').fill(dayOffset(14));
    await expect(page.getByText(/^Creates \d+ rides?$/)).toBeVisible();
    await expectNoAxeViolations(page);

    // No day chosen is an inline error, not a request.
    await pressed.click();
    await page.getByRole('button', { name: 'Publish rides' }).click();
    await expect(
      page.getByRole('alert').filter({ hasText: 'Choose at least one day.' }),
    ).toBeVisible();
    expect(fake.seriesPosts).toHaveLength(0);
    await pressed.click();

    await page.getByRole('button', { name: 'Publish rides' }).click();
    await expect(page).toHaveURL(/\/offer\/done$/, { timeout: 15_000 });
    expect(fake.seriesPosts).toHaveLength(1);
    expect(Object.keys(fake.seriesPosts[0]!).sort()).toEqual(
      [
        'autoAccept',
        'departureTime',
        'endsOn',
        'isFree',
        'previewId',
        'seats',
        'startsOn',
        'weekdays',
      ].sort(),
    );
    await expect(heading(page, 'Rides published')).toBeVisible();
    await expect(heading(page, 'Some days were skipped', 2)).toBeVisible();
    await expect(page.getByText(/Not published on .*: 4 rides that day already/)).toBeVisible();
    await expectNoAxeViolations(page);
  });

  test('a single ride still publishes as before and carries autoAccept', async ({ page }) => {
    test.slow();
    const { rides } = await setup(page);
    await page.goto('/offer');
    await chooseTripBTomorrow(page);
    await page.getByRole('switch', { name: 'Confirm requests automatically' }).check();
    await page.getByRole('button', { name: 'Publish ride' }).click();
    await expect(page).toHaveURL(/\/offer\/done$/, { timeout: 15_000 });
    expect(rides.published[0]!.autoAccept).toBe(true);
    await expect(heading(page, 'Ride published')).toBeVisible();
  });
});

test.describe('driver ride: auto-accept and series (E8-1, E8-3)', () => {
  const series = {
    id: 'c0c0c0c0-0000-4000-8000-000000000001',
    weekdays: [1, 3],
    departureTime: '07:30',
    startsOn: dayOffset(1),
    endsOn: dayOffset(20),
    status: 'active',
    upcomingCount: 6,
  };
  const RIDE = '10000000-0000-4000-8000-000000000001';

  async function openRide(page: Page, w: World) {
    w.rides.rides.push(
      seriesOwnerRide(RIDE, new Date(Date.now() + 86_400_000).toISOString(), series),
      seriesOwnerRide(
        '10000000-0000-4000-8000-000000000002',
        new Date(Date.now() + 3 * 86_400_000).toISOString(),
        series,
      ),
    );
    await page.goto(`/driving/${RIDE}`);
    await expect(heading(page, 'Your ride')).toBeVisible();
  }

  test('the switch saves at once and rolls back with a message when the server says no', async ({
    page,
  }) => {
    test.slow();
    const w = await setup(page);
    await openRide(page, w);
    const sw = page.getByRole('switch', { name: 'Confirm requests automatically' });
    await expect(sw).not.toBeChecked();
    await sw.check();
    await expect(sw).toBeChecked();
    await expect.poll(() => w.fake.patches).toEqual([{ id: RIDE, autoAccept: true }]);

    w.fake.failNextPatch = [409, 'INVALID_STATE'];
    await sw.click();
    await expect(page.getByRole('alert').filter({ hasText: /can’t be changed/ })).toBeVisible();
    await expect(sw).toBeChecked();
    await expectNoAxeViolations(page);
  });

  test('a series ride shows its chip and can cancel this ride only or all later rides', async ({
    page,
  }) => {
    test.slow();
    const w = await setup(page);
    await openRide(page, w);
    await expect(page.getByText(/^Weekly · Mon, Wed · until /)).toBeVisible();

    await page.getByRole('button', { name: 'Cancel ride' }).click();
    const sheet = page.getByRole('dialog');
    await expect(sheet.getByRole('radio', { name: 'Only this ride' })).toBeChecked();
    await sheet.getByRole('radio', { name: 'All upcoming rides in the series' }).check();
    await expectNoAxeViolations(page);
    await sheet.getByRole('button', { name: /^Cancel (this )?ride/ }).click();
    await expect.poll(() => w.fake.seriesCancels).toEqual([series.id]);
    await expect(page.getByText(/2 rides cancelled/)).toBeVisible();
  });
});

test.describe('instant confirmation (E8-3)', () => {
  test('the ride says so, the sheet promises it, and the booking opens as "You’re booked"', async ({
    page,
  }) => {
    test.slow();
    await seedSearch(page);
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
    search.ride = publicRide({ autoAccept: true });
    await mockSearchApi(page, search);
    const bk = newFakeBookings();
    await mockBookingsApi(page, bk);
    await mockLiquidityApi(page, newFakeLiquidity({ vapidPublicKey: null }));
    // The API confirms at once for an eligible passenger.
    await page.route('**/api/v1/bookings', async (route) => {
      if (route.request().method() !== 'POST') return route.fallback();
      bk.booking = bookingView({ autoConfirmed: true });
      return route.fulfill({ status: 201, json: bk.booking });
    });

    await page.goto(`/ride/${RIDE_ID}`);
    await expect(page.getByText('Instant confirmation')).toBeVisible();
    await expect(
      page.getByText(/confirms requests automatically, so you’re booked as soon as you ask/),
    ).toBeVisible();
    await expect(page.getByText('Fits your route. 150 m walk to pickup.')).toBeVisible({
      timeout: 15_000,
    });
    await expectNoAxeViolations(page);

    await page.getByRole('button', { name: 'Request seat' }).click();
    const sheet = page.getByRole('dialog', { name: 'Request a seat' });
    await expect(sheet.getByText(/Radu confirms requests automatically/)).toBeVisible();
    await expect(sheet.getByText(/the request expires/)).toHaveCount(0);
    await sheet.getByRole('button', { name: 'Send request' }).click();
    await expect(page).toHaveURL(new RegExp(`/booking/${BOOKING_ID}$`), { timeout: 15_000 });
    await expect(page.getByText('You’re booked')).toBeVisible();
    await expect(page.getByText('Waiting for Radu')).toHaveCount(0);
  });
});

test.describe('ride alerts (E8-2)', () => {
  async function emptyResults(page: Page, w?: Partial<FakeLiquidity>) {
    await seedSearch(page);
    const world = await setup(page, { liquidity: w ?? {} });
    const search = newFakeSearch();
    search.items = [];
    search.nearest = [tripBItem()];
    await mockSearchApi(page, search);
    return { ...world, search };
  }

  test('empty results: Notify me opens the sheet, Save stores one alert', async ({ page }) => {
    test.slow();
    const { fake } = await emptyResults(page);
    await page.goto('/results');
    await expect(heading(page, 'No rides found')).toBeVisible();
    const notify = page.getByRole('button', { name: 'Notify me about this route' });
    await expect(notify).toBeEnabled();
    await notify.click();
    const sheet = page.getByRole('dialog', { name: 'Notify me about this route' });
    await expect(sheet.getByRole('radio', { name: /^Only on / })).toBeChecked();
    await expect(sheet.getByRole('radio', { name: /^Every / })).toBeVisible();
    await expectNoAxeViolations(page);
    await sheet.getByRole('radio', { name: /^Every / }).check();
    await sheet.getByRole('button', { name: 'Save alert' }).click();
    await expect(page.getByText('Saved. We’ll tell you for 14 days.')).toBeVisible();
    expect(fake.alertPosts).toHaveLength(1);
    const body = fake.alertPosts[0]!;
    expect(body.windowMin).toBe(30);
    expect(body.time).toBe('07:30');
    expect(body.fromLabel).toBe('Șelimbăr');
    expect((body.schedule as { kind: string }).kind).toBe('weekly');
  });

  test('ALERT_LIMIT is explained with a link to the list', async ({ page }) => {
    test.slow();
    await emptyResults(page, { limitReached: true });
    await page.goto('/results');
    await page.getByRole('button', { name: 'Notify me about this route' }).click();
    const sheet = page.getByRole('dialog');
    await sheet.getByRole('button', { name: 'Save alert' }).click();
    await expect(sheet.getByRole('alert')).toContainText(
      'You have 5 alerts. Delete one to add another.',
    );
    await sheet.getByRole('link', { name: 'See my alerts' }).click();
    await expect(page).toHaveURL(/\/settings\/alerts$/);
  });

  test('non-empty results keep a quiet Notify me link', async ({ page }) => {
    await seedSearch(page);
    await setup(page);
    await mockSearchApi(page, newFakeSearch());
    await page.goto('/results');
    await expect(heading(page, '1 ride found')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Notify me about this route' })).toBeVisible();
  });

  test('signed out: the tap starts sign-in and returns to the results', async ({ page }) => {
    await seedSearch(page);
    await page.route('**/telemetry/error', (r) => r.fulfill({ status: 204 }));
    await mockPlaces(page);
    const search = newFakeSearch();
    search.items = [];
    await mockSearchApi(page, search);
    await mockLiquidityApi(page, newFakeLiquidity());
    await page.goto('/results');
    await page.getByRole('button', { name: 'Notify me about this route' }).click();
    await expect(page).toHaveURL(/\/auth$/);
    expect(await page.evaluate(() => sessionStorage.getItem('haide.intent'))).toContain(
      '/results?notify=1',
    );
  });

  test('coming back from sign-in reopens the sheet once', async ({ page }) => {
    test.slow();
    await emptyResults(page);
    await page.goto('/results?notify=1');
    await expect(page.getByRole('dialog', { name: 'Notify me about this route' })).toBeVisible();
    await expect(page).toHaveURL(/\/results$/);
  });

  test('the list shows route, schedule and end date; Delete removes it with a toast; empty state when none', async ({
    page,
  }) => {
    test.slow();
    const { fake } = await setup(page, { liquidity: { alerts: [rideAlert()] } });
    await page.goto('/settings/alerts');
    await expect(heading(page, 'Ride alerts')).toBeVisible();
    await expect(page.getByText('Șelimbăr to Zona Industrială Vest')).toBeVisible();
    await expect(page.getByText(/Every Mon · 07:30, ±30 min/)).toBeVisible();
    await expect(page.getByText(/^Ends /)).toBeVisible();
    await expectNoAxeViolations(page);
    await page.getByRole('button', { name: /^Delete the alert for/ }).click();
    await expect(page.getByText('Alert deleted.')).toBeVisible();
    expect(fake.alertDeletes).toHaveLength(1);
    await expect(heading(page, 'No alerts yet', 2)).toBeVisible();
    await expect(page.getByText('No alerts. Search for a route and tap Notify me.')).toBeVisible();
  });

  test('Settings has a Ride alerts row', async ({ page }) => {
    await setup(page);
    await page.goto('/profile');
    await page.getByRole('link', { name: /Ride alerts/ }).click();
    await expect(page).toHaveURL(/\/settings\/alerts$/);
  });

  test('a notification deep link matches with the alert’s own places', async ({ page }) => {
    test.slow();
    const alert = rideAlert();
    const w = await setup(page, { liquidity: { alerts: [alert] } });
    void w;
    const search = newFakeSearch();
    await mockSearchApi(page, search);
    await page.goto(`/ride/${RIDE_ID}?alert=${alert.id as string}`);
    await expect(page.getByText('Fits your route. 150 m walk to pickup.')).toBeVisible({
      timeout: 15_000,
    });
    expect(search.matches).toHaveLength(1);
    expect(search.matches[0]).toEqual({
      from: { lat: 45.7595, lng: 24.2128 },
      to: { lat: 45.7926, lng: 24.0973 },
    });
  });

  test('a deleted alert just leaves the plain ride', async ({ page }) => {
    await setup(page);
    await mockSearchApi(page, newFakeSearch());
    await page.goto(`/ride/${RIDE_ID}?alert=a1a1a1a1-0000-4000-8000-0000000000ff`);
    await expect(
      page.getByText('Search with your start and destination to request a seat.', { exact: false }),
    ).toBeVisible();
  });
});

test.describe('push (E8-4)', () => {
  async function bookingWorld(page: Page, push: Parameters<typeof stubPush>[1] = {}) {
    await stubPush(page, push);
    await seedSearch(page);
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
    await mockSearchApi(page, newFakeSearch());
    await mockBookingsApi(page, newFakeBookings());
    const fake = newFakeLiquidity();
    await mockLiquidityApi(page, fake);
    return fake;
  }

  async function sendRequest(page: Page) {
    await page.goto(`/ride/${RIDE_ID}`);
    await expect(page.getByText('Fits your route. 150 m walk to pickup.')).toBeVisible({
      timeout: 15_000,
    });
    await page.getByRole('button', { name: 'Request seat' }).click();
    await page
      .getByRole('dialog', { name: 'Request a seat' })
      .getByRole('button', { name: 'Send request' })
      .click();
    await expect(page).toHaveURL(new RegExp(`/booking/${BOOKING_ID}$`), { timeout: 15_000 });
  }

  test('the pre-prompt appears only after the first request; Turn on subscribes and registers', async ({
    page,
  }) => {
    test.slow();
    const fake = await bookingWorld(page);
    await page.goto('/find');
    await expect(heading(page, 'Find a ride')).toBeVisible();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    expect(
      await page.evaluate(
        () => (window as unknown as { __push: { requests: number } }).__push.requests,
      ),
    ).toBe(0);

    await sendRequest(page);
    const sheet = page.getByRole('dialog', { name: 'Get updates on your phone?' });
    await expect(sheet).toBeVisible();
    await expect(sheet.getByText(/No marketing/)).toBeVisible();
    await expectNoAxeViolations(page);
    await sheet.getByRole('button', { name: 'Turn on' }).click();
    await expect(page.getByText('Notifications turned on.')).toBeVisible();
    expect(fake.pushPuts).toHaveLength(1);
    expect((fake.pushPuts[0] as { endpoint: string }).endpoint).toMatch(
      /^https:\/\/fcm\.googleapis\.com\//,
    );
  });

  test('"Not now" is respected: no second ask for 30 days', async ({ page }) => {
    test.slow();
    const fake = await bookingWorld(page);
    await sendRequest(page);
    const sheet = page.getByRole('dialog', { name: 'Get updates on your phone?' });
    await sheet.getByRole('button', { name: 'Not now' }).click();
    await expect(sheet).toBeHidden();
    expect(await page.evaluate(() => localStorage.getItem('haide.pushPrompt'))).toMatch(/^\d+$/);
    expect(fake.pushPuts).toHaveLength(0);
    // Another request later in the same window: the sheet stays away.
    await sendRequest(page);
    await page.waitForTimeout(600);
    await expect(page.getByRole('dialog')).toHaveCount(0);
  });

  test('a blocked browser never gets the sheet', async ({ page }) => {
    test.slow();
    await bookingWorld(page, { permission: 'denied' });
    await sendRequest(page);
    await page.waitForTimeout(600);
    await expect(page.getByRole('dialog')).toHaveCount(0);
  });

  test('Settings toggle: on registers, off unsubscribes and deletes', async ({ page }) => {
    test.slow();
    const fake = newFakeLiquidity();
    await stubPush(page);
    await setup(page, { liquidity: fake });
    await page.goto('/profile');
    const sw = page.getByRole('switch', { name: 'Notifications on this device' });
    await expect(sw).not.toBeChecked();
    await expectNoAxeViolations(page);
    await sw.click();
    await expect(sw).toBeChecked();
    expect(fake.pushPuts).toHaveLength(1);
    await sw.click();
    await expect(page.getByText('Notifications turned off.')).toBeVisible();
    expect(fake.pushDeletes).toEqual([
      { endpoint: 'https://fcm.googleapis.com/fcm/send/e2e-device' },
    ]);
  });

  test('sign-out removes this device’s subscription first', async ({ page }) => {
    test.slow();
    const fake = newFakeLiquidity();
    await stubPush(page, { permission: 'granted', subscribed: true });
    await setup(page, { liquidity: fake });
    await page.goto('/profile');
    await page.getByRole('button', { name: 'Sign out' }).click();
    await expect(page).toHaveURL(/\/find$/);
    await expect
      .poll(() => fake.pushDeletes)
      .toEqual([{ endpoint: 'https://fcm.googleapis.com/fcm/send/e2e-device' }]);
    await expect
      .poll(() =>
        page.evaluate(
          () => (window as unknown as { __push: { unsubscribed: number } }).__push.unsubscribed,
        ),
      )
      .toBe(1);
  });

  test('push is hidden when the server has it off, and blocked is explained', async ({ page }) => {
    test.slow();
    await stubPush(page, { permission: 'denied' });
    await setup(page);
    await page.goto('/profile');
    const sw = page.getByRole('switch', { name: 'Notifications on this device' });
    await expect(sw).toBeDisabled();
    await expect(page.getByText(/blocked in your browser settings/)).toBeVisible();
  });

  test('server push off: no switch at all', async ({ page }) => {
    await stubPush(page);
    await setup(page, { liquidity: { vapidPublicKey: null } });
    await page.goto('/profile');
    await expect(heading(page, 'Notifications', 2)).toBeVisible();
    await expect(page.getByRole('switch', { name: 'Notifications on this device' })).toHaveCount(0);
  });
});

test.describe('monthly line (E8-5)', () => {
  test('driver line wins, passenger line is the fallback, nothing at zero', async ({ page }) => {
    test.slow();
    const { fake } = await setup(page, { liquidity: { month: { driver: 4200, passenger: 900 } } });
    await page.goto('/profile');
    await expect(page.getByText('This month you shared 42.00 RON of fuel costs')).toBeVisible();
    await expectNoAxeViolations(page);

    fake.month = { driver: 0, passenger: 900 };
    await page.reload();
    await expect(page.getByText('This month you paid 9.00 RON toward fuel costs')).toBeVisible();

    fake.month = { driver: 0, passenger: 0 };
    await page.reload();
    await expect(heading(page, 'Profile')).toBeVisible();
    await expect(page.getByText(/This month you/)).toHaveCount(0);
  });
});

for (const theme of ['dark', 'light'] as const) {
  test(`new E8 screens pass axe in ${theme}, with reduced motion`, async ({ page }) => {
    test.slow();
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await setup(page, {
      theme,
      liquidity: { alerts: [rideAlert()], month: { driver: 4200, passenger: 0 } },
    });
    await page.goto('/settings/alerts');
    await expect(heading(page, 'Ride alerts')).toBeVisible();
    await expectNoAxeViolations(page);
    await page.goto('/offer');
    await page.getByRole('switch', { name: 'Repeat on weekdays' }).check();
    await expectNoAxeViolations(page);
    await page.goto('/profile');
    await expect(page.getByText(/This month you shared/)).toBeVisible();
    await expectNoAxeViolations(page);
  });
}

test.describe('E8 bundle', () => {
  test('alerts, push and the series screens are lazy and the initial JS stays inside 200 KB gzip', async () => {
    const dist = new URL('../../apps/web/dist/', import.meta.url);
    const html = readFileSync(new URL('index.html', dist), 'utf8');
    const initial = [...html.matchAll(/(?:src|href)="\/(assets\/[^"]+\.js)"/g)].map((m) => m[1]!);
    expect(initial.length).toBeGreaterThan(0);
    const gz = initial.reduce(
      (sum, f) => sum + gzipSync(readFileSync(new URL(f, dist)), { level: 9 }).length,
      0,
    );
    expect(gz).toBeLessThan(200 * 1024);
    const all = readdirSync(new URL('assets/', dist));
    for (const name of ['AlertsScreen', 'NotifyMeSheet', 'PushHostImpl', 'PushSettings']) {
      expect(all.some((f) => f.startsWith(name))).toBe(true);
      expect(initial.some((f) => f.includes(name))).toBe(false);
    }
  });
});
