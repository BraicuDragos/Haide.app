import { expect, test, type Page } from '@playwright/test';
import { pickTime } from './time-helpers';
import { expectNoAxeViolations, mockAccountApi, newAccount, seedSession } from './accounts-helpers';
import { mockPopularApi } from './popular-helpers';
import { mockPlaces } from './rides-helpers';
import {
  mockSearchApi,
  newFakeSearch,
  publicRide,
  RIDE_ID,
  tripBItem,
  type FakeSearch,
} from './search-helpers';

// E3 (search and matching), passenger side. The API is mocked: search, ride detail and match answer with the Trip B
// figures from docs/product/pricing.md (3.10 / 2.00 / 1.50 RON). The server-side rules (match, ranking, privacy of the
// points) are covered by the integration tests of the backend half.

const heading = (page: Page, name: string | RegExp, level = 1) =>
  page.getByRole('heading', { level, name });

async function setup(page: Page, fake: FakeSearch = newFakeSearch()) {
  await page.route('**/telemetry/error', (r) => r.fulfill({ status: 204 }));
  await mockPlaces(page);
  await mockSearchApi(page, fake);
  await mockPopularApi(page);
  return fake;
}

async function pickPlace(page: Page, which: 'From' | 'To', query: string, name: string) {
  await page.getByRole('button', { name: new RegExp(`^${which}`) }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByRole('searchbox').fill(query);
  await expect(dialog.getByRole('heading', { name: /places? found/ })).toBeVisible();
  await dialog.getByRole('listitem').first().getByRole('button').click();
  await expect(dialog).toBeHidden();
  await expect(page.getByRole('button', { name: `${which} ${name}`, exact: true })).toBeVisible();
}

/** The Trip B search: Șelimbăr to Zona Industrială Vest, tomorrow around 07:30. */
async function searchTripB(page: Page) {
  await page.goto('/find');
  await pickPlace(page, 'From', 'selimbar', 'Șelimbăr');
  await pickPlace(page, 'To', 'zona', 'Zona Industrială Vest');
  await page.getByLabel('Day', { exact: true }).selectOption({ label: 'Tomorrow' });
  await pickTime(page, 'Leave around', '07:30');
  await page.getByRole('button', { name: 'Search rides' }).click();
}

test.describe('find', () => {
  test('a popular route opens the results at ±1 hour; Edit search keeps the places', async ({
    page,
  }) => {
    const fake = await setup(page);
    await page.goto('/find');
    await expect(heading(page, 'Popular routes', 2)).toBeVisible();
    await expect(page.getByRole('radio', { name: '±30 min' })).toBeChecked();
    await page.getByRole('button', { name: 'Șelimbăr to Zona Industrială Vest' }).click();
    await expect(page).toHaveURL(/\/results$/);
    await expect(heading(page, '1 ride found')).toBeVisible();
    expect(fake.searches).toHaveLength(1);
    expect(fake.searches[0]).toMatchObject({
      windowMin: 60,
      from: { lat: 45.7595, lng: 24.2128 },
      to: { lat: 45.7926, lng: 24.0973 },
    });
    await expect(page.getByText('Șelimbăr to Zona Industrială Vest')).toBeVisible();
    await page.getByRole('link', { name: 'Edit search' }).click();
    await expect(page.getByRole('button', { name: 'From Șelimbăr', exact: true })).toBeVisible();
    await expect(
      page.getByRole('button', { name: 'To Zona Industrială Vest', exact: true }),
    ).toBeVisible();
    await expectNoAxeViolations(page);
  });
});

test.describe('visitor journey (signed out)', () => {
  test('searches Șelimbăr to ZI Vest, sees Trip B at "Up to 3.10 RON", opens the detail', async ({
    page,
  }) => {
    test.slow();
    const fake = await setup(page);
    await searchTripB(page);

    // Results: the body carries places and time, never a URL.
    await expect(page).toHaveURL(/\/results$/);
    await expect(heading(page, '1 ride found')).toBeVisible();
    expect(fake.searches).toHaveLength(1);
    expect(fake.searches[0]).toMatchObject({ windowMin: 30, time: '07:30' });
    await expect(page.getByText('Șelimbăr to Zona Industrială Vest')).toBeVisible();
    await expect(page.getByText('Closest to your route first.')).toBeVisible();
    const card = page.getByRole('link', { name: /Up to 3\.10 RON/ });
    await expect(card).toBeVisible();
    await expect(card).toContainText('Șelimbăr, Shopping City area');
    await expect(card).toContainText('150 m walk to pickup');
    await expect(card).toContainText('100 m walk from drop-off');
    await expect(card).toContainText('Radu');
    await expect(card).toContainText('2 seats left');
    await expect(card).toContainText('Radu');
    await expectNoAxeViolations(page);

    // Detail.
    await card.click();
    await expect(page).toHaveURL(new RegExp(`/ride/${RIDE_ID}$`));
    await expect(heading(page, 'Ride details')).toBeVisible();
    await expect(page.getByText('Fits your route. 150 m walk to pickup.')).toBeVisible();
    await expect(page.getByText('About 150 m on foot from where you start')).toBeVisible();
    await expect(page.getByText('Grey Dacia Logan')).toBeVisible();
    await expect(page.getByText('Number plate shows after you’re accepted')).toBeVisible();
    await expect(page.getByText(/SB ?12/)).toHaveCount(0);
    await expect(page.getByText('Note from Radu')).toBeVisible();
    await expect(page.getByRole('row', { name: /3 passengers/ })).toContainText('1.50 RON');
    await expect(page.getByText(/You pay Radu directly/)).toBeVisible();
    await expect(page.getByRole('link', { name: /Radu/ })).toHaveAttribute(
      'href',
      /\/user\/8a1c2d3e/,
    );
    expect(fake.matches[0]).toMatchObject({ from: { lat: 45.7595 }, to: { lat: 45.7926 } });
    await expect(page.getByRole('button', { name: 'Request seat' })).toBeEnabled();
    await expectNoAxeViolations(page);
  });

  test('signed-out Request seat starts onboarding and remembers the ride', async ({ page }) => {
    await setup(page);
    await searchTripB(page);
    await page.getByRole('link', { name: /Up to 3\.10 RON/ }).click();
    await page.getByRole('button', { name: 'Request seat' }).click();
    await expect(page).toHaveURL(/\/auth$/);
    const intent = await page.evaluate(() => sessionStorage.getItem('haide.intent'));
    expect(JSON.parse(intent ?? '{}')).toEqual({
      kind: 'request',
      returnTo: `/ride/${RIDE_ID}?request=1`,
    });
  });
});

test.describe('signed in: return to the same ride', () => {
  test('consent step, then back on the ride', async ({ page }) => {
    test.slow();
    await setup(page);
    const acc = newAccount({
      firstName: 'Ioana',
      phoneE164: '+40721234567',
      profileComplete: true,
    });
    await seedSession(page);
    await mockAccountApi(page, acc);
    await searchTripB(page);
    await page.getByRole('link', { name: /Up to 3\.10 RON/ }).click();
    await page.getByRole('button', { name: 'Request seat' }).click();
    await expect(page).toHaveURL(/\/auth\/consent$/);
    await page.getByRole('checkbox', { name: 'I am 18 or older' }).check();
    await page.getByRole('checkbox', { name: /I accept the/ }).check();
    await page.getByRole('button', { name: 'Agree and continue' }).click();
    await expect(page).toHaveURL(new RegExp(`/ride/${RIDE_ID}`));
    // E4: the request sheet opens by itself once the gate is cleared.
    await expect(page.getByRole('dialog', { name: 'Request a seat' })).toBeVisible();
  });

  test('onboarded passenger: the tap goes ahead', async ({ page }) => {
    await setup(page);
    const acc = newAccount({
      firstName: 'Ioana',
      phoneE164: '+40721234567',
      profileComplete: true,
      consent: { upToDate: true, required: [] },
    });
    await seedSession(page);
    await mockAccountApi(page, acc);
    await searchTripB(page);
    await page.getByRole('link', { name: /Up to 3\.10 RON/ }).click();
    await page.getByRole('button', { name: 'Request seat' }).click();
    await expect(page.getByRole('dialog', { name: 'Request a seat' })).toBeVisible();
    await expect(page).toHaveURL(new RegExp(`/ride/${RIDE_ID}$`));
  });
});

test.describe('results states', () => {
  test('loading is the branded loader, then results', async ({ page }) => {
    const fake = await setup(page);
    let release!: () => void;
    fake.holdSearch = new Promise<void>((r) => (release = r));
    await searchTripB(page);
    await expect(
      page.getByRole('status').filter({ hasText: 'Looking for rides on your route' }),
    ).toBeVisible();
    await expect(heading(page, 'Looking for rides')).toBeVisible();
    release();
    await expect(heading(page, '1 ride found')).toBeVisible();
  });

  test('empty: nearest rides, Notify me, edit search, axe clean', async ({ page }) => {
    test.slow();
    const fake = await setup(page);
    fake.items = [];
    fake.nearest = [tripBItem()];
    await searchTripB(page);
    await expect(heading(page, 'No rides found')).toBeVisible();
    await expect(heading(page, 'No rides yet on this route', 2)).toBeVisible();
    await expect(page.getByRole('button', { name: 'Notify me about this route' })).toBeEnabled();
    await expect(heading(page, 'Closest rides outside your time window', 2)).toBeVisible();
    await expect(page.getByRole('link', { name: /Up to 3\.10 RON/ })).toContainText(
      'min from your time',
    );
    await expectNoAxeViolations(page);
    await page.getByRole('link', { name: 'Change time or places' }).click();
    // The form remembers the last search.
    await expect(page).toHaveURL(/\/find$/);
    await expect(page.getByRole('button', { name: 'From Șelimbăr', exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: /^Leave around/ })).toContainText('07:30');
  });

  test('blocked drivers are hidden with a note', async ({ page }) => {
    const fake = await setup(page);
    fake.hiddenBlockedCount = 1;
    await searchTripB(page);
    await expect(page.getByText('Rides from people you’ve blocked are hidden.')).toBeVisible();
  });

  test('error: says what happened and Try again recovers', async ({ page }) => {
    const fake = await setup(page);
    void fake;
    // The query client retries a 5xx once, so fail twice.
    let calls = 0;
    await page.route('**/api/v1/search', async (route) => {
      calls += 1;
      if (calls <= 2)
        return route.fulfill({
          status: 503,
          json: { error: { code: 'UPSTREAM_ERROR', message: 'x', requestId: 'r' } },
        });
      return route.fallback();
    });
    await searchTripB(page);
    await expect(heading(page, 'We couldn’t load rides')).toBeVisible();
    await expect(page.getByRole('alert')).toContainText('A service we rely on isn’t answering');
    await page.getByRole('button', { name: 'Try again' }).click();
    await expect(heading(page, '1 ride found')).toBeVisible();
  });

  test('results without a saved search go back to Find', async ({ page }) => {
    await setup(page);
    await page.goto('/results');
    await expect(page).toHaveURL(/\/find$/);
  });
});

test.describe('ride detail states', () => {
  async function openDetail(page: Page) {
    await searchTripB(page);
    await page.getByRole('link', { name: /Up to 3\.10 RON/ }).click();
    await expect(heading(page, 'Ride details')).toBeVisible();
  }

  for (const [code, text] of [
    ['RIDE_FULL', 'This ride is full'],
    ['RIDE_NOT_BOOKABLE', 'Requests close 10 minutes before departure'],
    ['OWN_RIDE', 'This is your ride'],
    ['ALREADY_REQUESTED', 'You already have a seat on this ride'],
    ['BLOCKED', 'This ride isn’t available to you.'],
    ['NO_LONGER_MATCHES', 'This ride no longer fits your search. Try a new search.'],
  ] as const) {
    test(`disabled reason ${code} is said in words`, async ({ page }) => {
      const fake = await setup(page);
      fake.match = {
        ...fake.match,
        bookable: false,
        notBookableReason: code,
        // Contract: a ride that no longer fits answers with null pickup, drop-off, price and ETA.
        ...(code === 'NO_LONGER_MATCHES'
          ? { pickup: null, dropoff: null, segmentM: null, priceUpToBani: null, pickupEtaAt: null }
          : {}),
      };
      await openDetail(page);
      const cta = page.getByRole('button', { name: 'Request seat' });
      await expect(cta).toBeDisabled();
      await expect(page.getByText(text, { exact: true })).toBeVisible();
      await expect(cta).toHaveAccessibleDescription(text);
    });
  }

  test('gone: a cancelled or past ride shows the explanation', async ({ page }) => {
    test.slow();
    const fake = await setup(page);
    await searchTripB(page);
    fake.ride = null;
    await page.goto(`/ride/${RIDE_ID}`);
    await expect(
      heading(
        page,
        'This ride is no longer available. It may have been cancelled or already left.',
        2,
      ),
    ).toBeVisible();
    await expect(page.getByRole('link', { name: 'Back to results' })).toBeVisible();
    await expectNoAxeViolations(page);
  });

  test('opened without a search: asks for one, no match call', async ({ page }) => {
    const fake = await setup(page);
    await page.goto(`/ride/${RIDE_ID}`);
    await expect(heading(page, 'Ride details')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Request seat' })).toBeDisabled();
    await expect(
      page.getByText('Search with your start and destination to request a seat.'),
    ).toBeVisible();
    await expect(page.getByRole('link', { name: 'Search this route' })).toBeVisible();
    expect(fake.matches).toHaveLength(0);
  });

  test('free ride and a rating-less driver', async ({ page }) => {
    const fake = await setup(page);
    fake.items = [tripBItem({ isFree: true, priceUpToBani: 0 })];
    fake.ride = publicRide({
      isFree: true,
      priceTable: [
        { passengers: 1, priceBani: 0 },
        { passengers: 2, priceBani: 0 },
      ],
      note: null,
    });
    fake.match = { ...fake.match, priceUpToBani: 0 };
    await searchTripB(page);
    await expect(page.getByRole('link', { name: /Free ride/ })).toBeVisible();
    await page.getByRole('link', { name: /Free ride/ }).click();
    await expect(page.getByRole('cell', { name: 'Free' }).first()).toBeVisible();
    await expect(page.getByText('Note from Radu')).toHaveCount(0);
  });
});

test.describe('motion', () => {
  test('shared element: only the tapped card carries the three names, once', async ({ page }) => {
    await setup(page);
    await page.addInitScript(() => {
      const w = window as unknown as { __vt: string[][] };
      w.__vt = [];
      const orig = document.startViewTransition?.bind(document);
      if (!orig) return;
      document.startViewTransition = ((cb: () => void) => {
        w.__vt.push(
          Array.from(document.querySelectorAll<HTMLElement>('[data-vt]'))
            .map((e) => e.style.viewTransitionName)
            .filter(Boolean),
        );
        return orig(cb);
      }) as typeof document.startViewTransition;
    });
    await searchTripB(page);
    await page.getByRole('link', { name: /Up to 3\.10 RON/ }).click();
    await expect(heading(page, 'Ride details')).toBeVisible();
    const names = await page.evaluate(() =>
      (window as unknown as { __vt: string[][] }).__vt.at(-1),
    );
    expect(names?.slice().sort()).toEqual(['ride-price', 'ride-route', 'ride-time']);
    // The details screen carries the same three names, once each.
    const onDetail = await page.evaluate(() =>
      ['.vt-time', '.vt-route', '.vt-price'].map((s) => document.querySelectorAll(s).length),
    );
    expect(onDetail).toEqual([1, 1, 1]);
  });

  test('reduced motion: instant navigation, route aligned, chip visible, axe clean light', async ({
    page,
  }) => {
    test.slow();
    await page.addInitScript(() => localStorage.setItem('haide.motion', 'reduced'));
    await setup(page);
    await page.addInitScript(() => {
      (window as unknown as { __vtCalls: number }).__vtCalls = 0;
      const orig = document.startViewTransition?.bind(document);
      if (!orig) return;
      document.startViewTransition = ((cb: () => void) => {
        (window as unknown as { __vtCalls: number }).__vtCalls += 1;
        return orig(cb);
      }) as typeof document.startViewTransition;
    });
    await searchTripB(page);
    await page.getByRole('link', { name: /Up to 3\.10 RON/ }).click();
    await expect(heading(page, 'Ride details')).toBeVisible();
    await expect(page.getByText('Fits your route. 150 m walk to pickup.')).toBeVisible();
    expect(await page.evaluate(() => (window as unknown as { __vtCalls: number }).__vtCalls)).toBe(
      0,
    );
    await expect(page.locator('html')).toHaveAttribute('data-motion', 'reduced');
    await page.evaluate(() => localStorage.setItem('haide.theme', 'light'));
    await page.reload();
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
    await expect(page.getByText('Fits your route. 150 m walk to pickup.')).toBeVisible();
    await expectNoAxeViolations(page);
  });
});

test.describe('layout', () => {
  test('results and detail fit 360 px without horizontal scroll, touch targets 44 px', async ({
    page,
  }) => {
    await setup(page);
    await searchTripB(page);
    await expect(heading(page, '1 ride found')).toBeVisible();
    const fits = () =>
      page.evaluate(
        () => document.documentElement.scrollWidth <= document.documentElement.clientWidth,
      );
    expect(await fits()).toBe(true);
    await page.getByRole('link', { name: /Up to 3\.10 RON/ }).click();
    await expect(heading(page, 'Ride details')).toBeVisible();
    expect(await fits()).toBe(true);
    for (const el of [
      page.getByRole('button', { name: 'Request seat' }),
      page.getByRole('button', { name: 'Back' }),
      page.getByRole('link', { name: /Radu/ }),
    ]) {
      const box = await el.boundingBox();
      expect(box?.height ?? 0).toBeGreaterThanOrEqual(44);
    }
  });
});
