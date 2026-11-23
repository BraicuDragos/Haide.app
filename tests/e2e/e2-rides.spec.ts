import { expect, test, type Page } from '@playwright/test';
import { pickTime } from './time-helpers';
import { expectNoAxeViolations, mockAccountApi, newAccount, seedSession } from './accounts-helpers';
import {
  mockPlaces,
  mockRidesApi,
  newFakeRides,
  readyDriver,
  type FakeRides,
} from './rides-helpers';

// E2 (publish and manage rides), driver side. The API is mocked with a stateful fake that mirrors the server rules and
// answers Trip B with the figures from docs/product/pricing.md (ROUTING_PROVIDER=fixture on the real stack returns the
// same route, so the numbers are the same there). The real-stack variant needs a signed-in session helper that is not
// shared with e1-magic-link yet; see the PR notes.

const heading = (page: Page, name: string | RegExp, level = 1) =>
  page.getByRole('heading', { level, name });

async function setup(page: Page, opts: { vehicle?: boolean } = {}) {
  const fake = newFakeRides();
  const acc = opts.vehicle === false ? newAccount() : readyDriver();
  if (opts.vehicle === false) {
    acc.me.consent = { upToDate: true, required: [] };
    acc.me.profileComplete = true;
    acc.me.firstName = 'Ioana';
  }
  await seedSession(page);
  await mockAccountApi(page, acc);
  await mockPlaces(page);
  await mockRidesApi(page, fake);
  return fake;
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

/** Trip B: Șelimbăr, Shopping City to Zona Industrială Vest. */
async function chooseTripB(page: Page) {
  await pickPlace(page, 'From', 'selimbar', 'Șelimbăr');
  await pickPlace(page, 'To', 'zona', 'Zona Industrială Vest');
  await expect(page.getByText('9.6 km, about 17 min')).toBeVisible();
}

async function whenTomorrow(page: Page) {
  await page.getByLabel('Day', { exact: true }).selectOption({ label: 'Tomorrow' });
  await pickTime(page, 'Leaving at', '07:30');
}

const bucharestClock = (iso: string) =>
  new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Europe/Bucharest',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).format(new Date(iso));

test.describe('gate', () => {
  test('signed out: explains the value and starts onboarding, axe clean', async ({ page }) => {
    await page.goto('/offer');
    await expect(heading(page, 'Offer a ride')).toBeVisible();
    await expect(heading(page, 'Sign in to offer a ride', 2)).toBeVisible();
    await expect(page.getByRole('button', { name: 'Sign in or create account' })).toBeVisible();
    await expectNoAxeViolations(page);
  });

  test('signed in without a car: asks for the car first', async ({ page }) => {
    await setup(page, { vehicle: false });
    await page.goto('/offer');
    await expect(heading(page, 'Add your car first', 2)).toBeVisible();
    await page.getByRole('button', { name: 'Add car' }).click();
    await expect(page).toHaveURL(/\/setup\/vehicle$/);
  });
});

for (const theme of ['dark', 'light'] as const) {
  test.describe(`${theme} theme`, () => {
    test.beforeEach(async ({ page }) => {
      await page.addInitScript((t) => window.localStorage.setItem('haide.theme', t), theme);
    });

    test('driver publishes Trip B and sees 3.10 / 2.00 / 1.50 RON, then lists and cancels it', async ({
      page,
    }) => {
      // One long journey (publish, price table, detail, list, cancel) with 6 axe scans: ~40 s, over the 30 s default.
      test.slow();
      const fake = await setup(page);
      await page.goto('/offer');
      await expect(heading(page, 'Offer a ride')).toBeVisible();
      await expect(page.getByText('Choose both places to see the price.')).toBeVisible();
      await expectNoAxeViolations(page);

      await chooseTripB(page);

      // Price table: every row to the bani, the recover line and the lock line.
      const table = page.getByRole('table');
      await expect(table.getByRole('row', { name: /1 passenger/ })).toContainText('3.10 RON');
      await expect(table.getByRole('row', { name: /2 passengers/ })).toContainText('2.00 RON');
      await expect(table.getByRole('row', { name: /3 passengers/ })).toContainText('1.50 RON');
      await expect(page.getByText('Diesel, 9.6 km')).toBeVisible();
      await expect(
        page.getByText('With 3 passengers you recover about 4.50 RON of the 6.24 RON fuel cost.'),
      ).toBeVisible();
      await expect(page.getByText('The price is set by Haide. You can’t raise it.')).toBeVisible();
      // Seats are limited to the car (3); Repeat on weekdays is live since E8.
      await expect(page.getByRole('radio')).toHaveCount(3);
      await expect(page.getByRole('switch', { name: /Repeat on weekdays/ })).toBeEnabled();
      await expect(page.getByText('Coming soon')).toHaveCount(0);

      // Seats change the recover line (1 passenger pays the most).
      await page.getByRole('radio', { name: '1 seat', exact: true }).check();
      await expect(
        page.getByText('With 1 passenger you recover about 3.10 RON of the 6.24 RON fuel cost.'),
      ).toBeVisible();
      await page.getByRole('radio', { name: '3 seats', exact: true }).check();

      await expectNoAxeViolations(page);

      // Time rule, inline: the clock is fixed at about 22:00 in Bucharest, so today's default 07:30 is in the past.
      const todayRo = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Bucharest' }).format(
        new Date(),
      );
      await page.clock.setFixedTime(new Date(`${todayRo}T19:30:00Z`));
      await page.getByRole('button', { name: 'Publish ride' }).click();
      await expect(page.getByText('Choose a time at least 15 minutes from now.')).toBeVisible();
      await expect(page.getByRole('button', { name: /^Leaving at/ })).toBeFocused();
      // The picker greys out the past: nothing before 22:15 is selectable today.
      await page.getByRole('button', { name: /^Leaving at/ }).click();
      const hourGroup = page.getByRole('dialog').getByRole('radiogroup', { name: 'Hour' });
      await expect(hourGroup.getByRole('radio', { name: '07', exact: true })).toBeDisabled();
      await expect(hourGroup.getByRole('radio', { name: '23', exact: true })).toBeEnabled();
      await page.keyboard.press('Escape');
      await expect(page.getByRole('dialog')).toBeHidden();
      await expect(page.getByRole('button', { name: /^Leaving at/ })).toBeFocused();
      expect(fake.published).toHaveLength(0);

      await whenTomorrow(page);
      await page.getByLabel('Note for passengers').fill('Blue backpack on the dashboard');
      await page.getByRole('button', { name: 'Publish ride' }).click();

      // Ride published (2.4)
      await expect(page).toHaveURL(/\/offer\/done$/);
      await expect(heading(page, 'Ride published')).toBeVisible();
      await expect(page.getByText('Passengers can find your ride now.')).toBeVisible();
      await expect(page.getByText('07:30', { exact: true })).toBeVisible();
      await expect(page.getByText('Tomorrow', { exact: true })).toBeVisible();
      expect(fake.published).toHaveLength(1);
      expect(fake.published[0]).toMatchObject({
        seats: 3,
        isFree: false,
        note: 'Blue backpack on the dashboard',
      });
      expect(bucharestClock(fake.published[0]!.departureAt as string)).toBe('07:30');
      await expectNoAxeViolations(page);

      // Driver ride (2.6)
      await page.getByRole('link', { name: 'View my ride' }).click();
      await expect(heading(page, 'Your ride')).toBeVisible();
      await expect(page.getByText('07:30', { exact: true })).toBeVisible();
      await expect(page.getByText('Published', { exact: true })).toBeVisible();
      await expect(page.getByText('0 of 3 seats taken')).toBeVisible();
      await expect(page.getByText('No requests yet.')).toBeVisible();
      await expect(page.getByText('No passengers yet.', { exact: true })).toBeVisible();
      await expect(page.getByRole('row', { name: /3 passengers/ })).toContainText('1.50 RON');
      await expect(page.getByRole('group', { name: /exact pickup and drop-off/ })).toBeVisible();
      await expectNoAxeViolations(page);

      // Driving list (2.5)
      await page.getByRole('button', { name: 'Back' }).click();
      await page.goto('/rides?role=driving');
      await expect(heading(page, 'My rides')).toBeVisible();
      const card = page.getByRole('link', { name: /07:30/ });
      await expect(card).toContainText('Șelimbăr');
      await expect(card).toContainText('0 of 3 seats taken');
      await expectNoAxeViolations(page);

      // Cancel sheet (2.7)
      await card.click();
      await page.getByRole('button', { name: 'Cancel ride' }).click();
      const sheet = page.getByRole('dialog', { name: 'Cancel this ride?' });
      await expect(sheet.getByText('No passengers have booked yet.')).toBeVisible();
      await expect(sheet.getByText('late cancellation')).toHaveCount(0);
      await expectNoAxeViolations(page);
      await sheet.getByRole('button', { name: 'Cancel ride' }).click();
      await expect(page.getByText('Ride cancelled', { exact: true }).first()).toBeVisible();
      await expect(page.getByText('You cancelled this ride')).toBeVisible();
      await expect(page.getByRole('button', { name: 'Cancel ride' })).toHaveCount(0);

      // The Cancelled tab holds it (Past does not), Upcoming shows the empty state.
      await page.goto('/rides?role=driving');
      await expect(heading(page, 'You haven’t offered a ride yet', 2)).toBeVisible();
      await page.getByRole('tab', { name: 'Past' }).click();
      await expect(page.getByRole('link', { name: /07:30/ })).toHaveCount(0);
      await page.getByRole('tab', { name: 'Cancelled' }).click();
      await expect(page.getByRole('link', { name: /07:30/ })).toContainText('Ride cancelled');
      await expectNoAxeViolations(page);
    });
  });
}

test.describe('publish form states', () => {
  test('same place is an inline error and no route is requested', async ({ page }) => {
    const fake = await setup(page);
    await page.goto('/offer');
    await pickPlace(page, 'From', 'selimbar', 'Șelimbăr');
    await pickPlace(page, 'To', 'selimbar', 'Șelimbăr');
    await expect(
      page.getByText('Start and destination are the same place. Choose two different places.'),
    ).toBeVisible();
    expect(fake.previews).toBe(0);
    await expectNoAxeViolations(page);
  });

  test('route service down shows Try again, then the price table', async ({ page }) => {
    const fake = await setup(page);
    fake.failNext.preview = [503, 'ROUTING_UNAVAILABLE'];
    await page.goto('/offer');
    await pickPlace(page, 'From', 'selimbar', 'Șelimbăr');
    await pickPlace(page, 'To', 'zona', 'Zona Industrială Vest');
    await expect(page.getByRole('alert')).toContainText('Our route service isn’t answering');
    await expectNoAxeViolations(page);
    await page.getByRole('button', { name: 'Try again' }).click();
    await expect(page.getByText('9.6 km, about 17 min')).toBeVisible();
    await expect(page.getByRole('row', { name: /1 passenger/ })).toContainText('3.10 RON');
  });

  test('route too long is a distance error at the places', async ({ page }) => {
    const fake = await setup(page);
    fake.failNext.preview = [400, 'ROUTE_TOO_LONG'];
    await page.goto('/offer');
    await pickPlace(page, 'From', 'selimbar', 'Șelimbăr');
    await pickPlace(page, 'To', 'zona', 'Zona Industrială Vest');
    await expect(page.getByText('Rides must be between 1 and 40 km.')).toBeVisible();
  });

  test('free switch shows Free in every row and drops the recover line', async ({ page }) => {
    const fake = await setup(page);
    await page.goto('/offer');
    await chooseTripB(page);
    await page.getByRole('switch', { name: /Offer this ride for free/ }).check();
    await expect(page.getByRole('row', { name: /2 passengers/ })).toContainText('Free');
    await expect(page.getByText(/you recover about/)).toHaveCount(0);
    await whenTomorrow(page);
    await page.getByRole('button', { name: 'Publish ride' }).click();
    await expect(page).toHaveURL(/\/offer\/done$/);
    expect(fake.published[0]).toMatchObject({ isFree: true });
  });

  test('daily limit (409) is a banner naming the day, and the form keeps its data', async ({
    page,
  }) => {
    const fake = await setup(page);
    fake.failNext.publish = [409, 'DAILY_RIDE_LIMIT'];
    await page.goto('/offer');
    await chooseTripB(page);
    await whenTomorrow(page);
    await page.getByRole('button', { name: 'Publish ride' }).click();
    await expect(
      page.getByRole('alert').filter({ hasText: 'You’ve reached 4 rides on' }),
    ).toBeVisible();
    await expect(page).toHaveURL(/\/offer$/);
    await expect(page.getByRole('button', { name: 'Publish ride' })).toBeEnabled();
    await expect(page.getByRole('button', { name: 'From Șelimbăr' })).toBeVisible();
    await expectNoAxeViolations(page);
  });

  test('server time errors (400) land on the time field', async ({ page }) => {
    const fake = await setup(page);
    await page.goto('/offer');
    await chooseTripB(page);
    await whenTomorrow(page);
    fake.failNext.publish = [400, 'DEPARTURE_TOO_FAR'];
    await page.getByRole('button', { name: 'Publish ride' }).click();
    await expect(page.getByText('You can publish up to 14 days ahead.')).toBeVisible();
    await expect(page.getByRole('button', { name: /^Leaving at/ })).toHaveAttribute(
      'aria-invalid',
      'true',
    );
  });

  test('expired preview re-prices and asks to publish again', async ({ page }) => {
    const fake = await setup(page);
    await page.goto('/offer');
    await chooseTripB(page);
    await whenTomorrow(page);
    fake.failNext.publish = [400, 'PREVIEW_EXPIRED'];
    await page.getByRole('button', { name: 'Publish ride' }).click();
    await expect(page.getByText(/Your route price timed out/)).toBeVisible();
    await expect.poll(() => fake.previews).toBe(2);
    await expect(page.getByText('9.6 km, about 17 min')).toBeVisible();
    await page.getByRole('button', { name: 'Publish ride' }).click();
    await expect(page).toHaveURL(/\/offer\/done$/);
  });

  test('offline: publishing says so and nothing is sent', async ({ page, context }) => {
    const fake = await setup(page);
    await page.goto('/offer');
    await chooseTripB(page);
    await whenTomorrow(page);
    await context.setOffline(true);
    await page.getByRole('button', { name: 'Publish ride' }).click();
    await expect(page.getByText('You’re offline. Connect to publish your ride.')).toBeVisible();
    expect(fake.published).toHaveLength(0);
    await context.setOffline(false);
  });
});

test.describe('manage rides', () => {
  async function published(page: Page, fake: FakeRides) {
    await page.goto('/offer');
    await chooseTripB(page);
    await whenTomorrow(page);
    await page.getByRole('button', { name: 'Publish ride' }).click();
    await expect(page).toHaveURL(/\/offer\/done$/);
    return fake.rides[0]!.id as string;
  }

  test('cancel on a ride that already moved on (409 INVALID_STATE) explains it', async ({
    page,
  }) => {
    const fake = await setup(page);
    const id = await published(page, fake);
    await page.goto(`/driving/${id}`);
    await page.getByRole('button', { name: 'Cancel ride' }).click();
    fake.failNext.cancel = [409, 'INVALID_STATE'];
    await page
      .getByRole('dialog', { name: 'Cancel this ride?' })
      .getByRole('button', { name: 'Cancel ride' })
      .click();
    await expect(
      page.getByRole('alert').filter({ hasText: 'can’t be changed any more' }),
    ).toBeVisible();
  });

  test('a ride closer than 30 minutes warns about a late cancellation', async ({ page }) => {
    const fake = await setup(page);
    const id = await published(page, fake);
    fake.rides[0]!.lateCancelIfNow = true;
    await page.goto(`/driving/${id}`);
    await page.getByRole('button', { name: 'Cancel ride' }).click();
    await expect(
      page.getByText(
        'Cancelling within 30 minutes of departure counts as a late cancellation on your profile.',
      ),
    ).toBeVisible();
    await expectNoAxeViolations(page);
    await page.getByRole('button', { name: 'Keep ride' }).click();
    await expect(page.getByRole('dialog')).toBeHidden();
  });

  test('unknown ride id: not found with a way back', async ({ page }) => {
    await setup(page);
    await page.goto('/driving/00000000-0000-4000-8000-000000000999');
    await expect(page.getByText('This page doesn’t exist.')).toBeVisible();
    await page.getByRole('link', { name: 'My rides' }).click();
    await expect(page).toHaveURL(/\/rides\?role=driving$/);
  });

  test('driving list: failure shows a retry', async ({ page }) => {
    await setup(page);
    await page.route('**/api/v1/me/rides?*', (r) => r.abort());
    await page.goto('/rides?role=driving');
    await expect(page.getByRole('alert')).toContainText('We couldn’t load your rides');
    await expect(page.getByRole('button', { name: 'Try again' })).toBeVisible();
  });

  test('reduced motion: publish still completes and lands on Ride published', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    const fake = await setup(page);
    await published(page, fake);
    await expect(heading(page, 'Ride published')).toBeVisible();
  });
});
