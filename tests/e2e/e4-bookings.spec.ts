import { expect, test, type Page } from '@playwright/test';
import { expectNoAxeViolations, mockAccountApi, newAccount, seedSession } from './accounts-helpers';
import {
  BOOKING_ID,
  bookingView,
  listItem,
  mockBookingsApi,
  newFakeBookings,
  OWNER_RIDE_ID,
  REQUEST_A,
  requestedView,
  type FakeBookings,
} from './booking-helpers';
import { mockPlaces, PLACES } from './rides-helpers';
import { mockSearchApi, newFakeSearch, RIDE_ID, type FakeSearch } from './search-helpers';

// E4 (booking lifecycle), web side. The API is mocked: the server rules (guards, locks, price relock, reveal window)
// are covered by the backend unit and integration suites. These specs check what the person sees and does at 360x800,
// in dark and light, and that every number on screen is the one the API sent.

const heading = (page: Page, name: string | RegExp, level = 1) =>
  page.getByRole('heading', { level, name });

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

interface World {
  search: FakeSearch;
  bk: FakeBookings;
}

/** The passenger's last search (Trip B), as the Find screen leaves it in sessionStorage. */
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
    {
      from: PLACES[0],
      to: PLACES[1],
      day: new Date(Date.now() + 86_400_000).toISOString().slice(0, 10),
      time: '07:30',
      win: '30',
    },
  );
}

/** A signed-in, onboarded passenger who just searched Trip B (the search lives in sessionStorage). */
async function setup(page: Page, theme: 'dark' | 'light' = 'dark'): Promise<World> {
  await page.addInitScript((t) => window.localStorage.setItem('haide.theme', t), theme);
  await seedSearch(page);
  await page.route('**/telemetry/error', (r) => r.fulfill({ status: 204 }));
  const search = newFakeSearch();
  const bk = newFakeBookings();
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
  await mockSearchApi(page, search);
  await mockBookingsApi(page, bk);
  return { search, bk };
}

async function openSheet(page: Page) {
  await page.goto(`/ride/${RIDE_ID}`);
  await expect(page.getByText('Fits your route. 150 m walk to pickup.')).toBeVisible();
  await page.getByRole('button', { name: 'Request seat' }).click();
  const sheet = page.getByRole('dialog', { name: 'Request a seat' });
  await expect(sheet).toBeVisible();
  return sheet;
}

test.describe('request a seat (4.1)', () => {
  test('the sheet says who decides, until when and what stays hidden; Send leaves and opens the booking', async ({
    page,
  }) => {
    test.slow();
    const { bk } = await setup(page);
    const sheet = await openSheet(page);

    await expect(
      sheet.getByText(/· Șelimbăr, Shopping City area to Zona Industrială Vest/),
    ).toBeVisible();
    await expect(sheet.getByText('Up to')).toBeVisible();
    await expect(sheet.getByText('3.10 RON')).toBeVisible();
    await expect(
      sheet.getByText('Radu decides whether to accept.', { exact: false }),
    ).toBeVisible();
    await expect(
      sheet.getByText(/If Radu doesn’t answer by \d\d:\d\d, the request expires\./),
    ).toBeVisible();
    await expect(
      sheet.getByText('Pickup and drop-off stay approximate until Radu accepts.'),
    ).toBeVisible();
    await expectNoAxeViolations(page);

    bk.booking = null;
    await sheet.getByRole('button', { name: 'Send request' }).click();
    await expect(page).toHaveURL(new RegExp(`/booking/${BOOKING_ID}$`), { timeout: 15_000 });
    expect(bk.created).toHaveLength(1);
    const sent = bk.created[0]!;
    // A fresh uuid per attempt; the body carries the ride and the typed places and never a price.
    expect(sent.key).toMatch(UUID);
    expect(Object.keys(sent.body).sort()).toEqual(['from', 'rideId', 'to']);
    expect(sent.body.rideId).toBe(RIDE_ID);
    await expect(heading(page, 'Your seat')).toBeVisible();
    await expect(page.getByText('Waiting for Radu')).toBeVisible();
    await expect(heading(page, 'You pay up to 3.10 RON to Radu', 2)).toBeVisible();
  });

  const refusals: Array<[string, string]> = [
    ['RIDE_FULL', 'This ride just filled up. See other rides on your route.'],
    ['RIDE_NOT_BOOKABLE', 'This ride leaves in under 10 minutes, so requests are closed.'],
    ['OWN_RIDE', 'This is your own ride. You can’t request a seat on it.'],
    ['BLOCKED', 'This ride isn’t available to you.'],
    ['NO_LONGER_MATCHES', 'This ride no longer fits your search. Try a new search.'],
    ['ALREADY_REQUESTED', 'You already have a request on this ride.'],
  ];
  for (const [code, text] of refusals) {
    test(`${code} is explained in the sheet and nothing launches`, async ({ page }) => {
      const { bk } = await setup(page);
      bk.failNextCreate = code;
      const sheet = await openSheet(page);
      await sheet.getByRole('button', { name: 'Send request' }).click();
      await expect(sheet.getByRole('alert')).toContainText(text);
      await expect(page).toHaveURL(new RegExp(`/ride/${RIDE_ID}$`));
      // The button is restored without the wordmark and, for a settled refusal, stays off.
      await expect(sheet.getByRole('button', { name: 'Send request' })).toBeVisible();
      await expect(sheet.locator('.cta')).not.toHaveClass(/is-done/);
    });
  }

  test('ALREADY_REQUESTED links to the existing booking', async ({ page }) => {
    const { search, bk } = await setup(page);
    search.ride = {
      ...(search.ride as Record<string, unknown>),
      viewer: {
        isDriver: false,
        bookingId: BOOKING_ID,
        bookingStatus: 'requested',
        blocked: false,
      },
    };
    bk.booking = requestedView();
    await page.goto(`/ride/${RIDE_ID}`);
    await expect(page.getByText('You already have a seat on this ride')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Request seat' })).toBeDisabled();
    await page.getByRole('link', { name: 'View your request' }).click();
    await expect(page).toHaveURL(new RegExp(`/booking/${BOOKING_ID}$`));
  });

  test('a declined passenger cannot ask again (reason shown, link to the booking)', async ({
    page,
  }) => {
    const { search } = await setup(page);
    search.ride = {
      ...(search.ride as Record<string, unknown>),
      viewer: { isDriver: false, bookingId: BOOKING_ID, bookingStatus: 'rejected', blocked: false },
    };
    await page.goto(`/ride/${RIDE_ID}`);
    await expect(page.getByRole('button', { name: 'Request seat' })).toBeDisabled();
    await expect(page.getByRole('link', { name: 'View your request' })).toBeVisible();
  });

  test('offline: the request is queued with one key and sent once the connection is back', async ({
    page,
  }) => {
    test.slow();
    const { bk } = await setup(page);
    const sheet = await openSheet(page);
    // The first attempt gets no answer at all (the server may or may not have it): the key must survive.
    bk.failNextCreate = 'ABORT';
    await sheet.getByRole('button', { name: 'Send request' }).click();
    await expect(
      page.getByText('Not sent yet. We’ll send your request when you’re back online.'),
    ).toBeVisible({
      timeout: 15_000,
    });
    await expect(page.getByRole('button', { name: 'Request seat' })).toBeDisabled();
    expect(bk.created).toHaveLength(1);

    await page.evaluate(() => window.dispatchEvent(new Event('online')));
    await expect(page).toHaveURL(new RegExp(`/booking/${BOOKING_ID}$`), { timeout: 15_000 });
    expect(bk.created).toHaveLength(2);
    expect(bk.created[1]!.key).toBe(bk.created[0]!.key);
    expect(bk.created[1]!.key).toMatch(UUID);
  });

  test('signed out: the tap starts sign-in and returns to the ride (return-to-intent)', async ({
    page,
  }) => {
    await seedSearch(page);
    const search = newFakeSearch();
    await page.route('**/telemetry/error', (r) => r.fulfill({ status: 204 }));
    await mockSearchApi(page, search);
    await page.goto(`/ride/${RIDE_ID}`);
    await page.getByRole('button', { name: 'Request seat' }).click();
    await expect(page).toHaveURL(/\/auth$/);
    expect(await page.evaluate(() => sessionStorage.getItem('haide.intent'))).toContain(
      `/ride/${RIDE_ID}?request=1`,
    );
  });
});

test.describe('booking detail (4.2, 4.3)', () => {
  test('confirmed: exact points, price, timeline, Call and WhatsApp, plate; marks the update as seen', async ({
    page,
  }) => {
    test.slow();
    const { bk } = await setup(page);
    bk.booking = bookingView({ unseen: true });
    await page.goto(`/booking/${BOOKING_ID}`);

    await expect(page.getByText('Radu accepted your request')).toBeVisible();
    await expect(page.getByText('Be at the pickup point 5 minutes early.')).toBeVisible();
    await expect(heading(page, 'You pay 2.60 RON to Radu', 2)).toBeVisible();
    await expect(
      page.getByText('Price dropped to 2.60 RON because another passenger joined.'),
    ).toBeVisible();
    await expect(page.getByText('Your price can only go down.')).toBeVisible();
    await expect(page.getByText('In cash or by transfer when you meet.')).toBeVisible();
    // Exact points: the map says so and the pickup is not "approximate".
    await expect(page.getByText('Exact.', { exact: false }).first()).toBeVisible();
    await expect(page.getByText('Approximate until accepted')).toHaveCount(0);
    await expect(page.getByText('SB12ABC')).toBeVisible();
    const timeline = page.getByRole('list').filter({ hasText: 'Requested' });
    await expect(timeline.getByRole('listitem')).toHaveCount(2);

    await expect(page.getByRole('link', { name: 'Call Radu' })).toHaveAttribute(
      'href',
      'tel:+40722334455',
    );
    await expect(page.getByRole('link', { name: 'Message Radu on WhatsApp' })).toHaveAttribute(
      'href',
      'https://wa.me/40722334455',
    );
    await expect(
      page.getByText(/Visible until .*Contact details and exact points hide 24 hours/),
    ).toBeVisible();

    await expect.poll(() => bk.seen).toEqual([[BOOKING_ID]]);
    await expectNoAxeViolations(page);
  });

  test('requested: approximate points with the locked-row explanation, no contact, no plate', async ({
    page,
  }) => {
    const { bk } = await setup(page);
    bk.booking = requestedView();
    await page.goto(`/booking/${BOOKING_ID}`);
    await expect(page.getByText('Waiting for Radu')).toBeVisible();
    await expect(page.getByText(/Radu has until \d\d:\d\d to answer/)).toBeVisible();
    await expect(page.getByText('Approximate.', { exact: false }).first()).toBeVisible();
    await expect(
      page.getByText(
        'Exact points show once Radu accepts. They hide again 24 hours after the ride.',
      ),
    ).toBeVisible();
    await expect(page.getByText('Shows after Radu accepts')).toBeVisible();
    await expect(page.getByRole('link', { name: 'Call Radu' })).toHaveCount(0);
    await expect(page.getByText('Price dropped')).toHaveCount(0);
    await expect(heading(page, 'You pay up to 3.10 RON to Radu', 2)).toBeVisible();
    // No unseen flag, so nothing is reported as seen.
    expect(bk.seen).toEqual([]);
  });

  const endings: Array<[string, Record<string, unknown>, string, boolean]> = [
    ['rejected', { status: 'rejected' }, 'Radu can’t take you this time', true],
    ['expired', { status: 'expired' }, 'Request expired', true],
    [
      'cancelled by me',
      { status: 'cancelled', cancelledBy: 'passenger' },
      'You cancelled this booking',
      true,
    ],
    [
      'ride cancelled by the driver',
      {
        status: 'cancelled',
        cancelledBy: 'driver',
        rideStatus: 'cancelled',
        timeline: [
          { status: 'requested', at: new Date(Date.now() - 600_000).toISOString() },
          { status: 'ride_cancelled', at: new Date(Date.now() - 60_000).toISOString() },
        ],
      },
      'Radu cancelled this ride',
      true,
    ],
  ];
  for (const [name, over, text, again] of endings) {
    test(`${name}: says so and offers another ride`, async ({ page }) => {
      const { bk } = await setup(page);
      bk.booking = requestedView({
        contact: null,
        actions: { ...(bookingView().actions as Record<string, unknown>), canCancel: false },
        ...over,
      });
      await page.goto(`/booking/${BOOKING_ID}`);
      await expect(page.getByText(text)).toBeVisible();
      await expect(page.getByRole('button', { name: 'Cancel booking' })).toHaveCount(0);
      if (again) await expect(page.getByRole('link', { name: 'Find another ride' })).toBeVisible();
    });
  }

  test('cancel sheet: late warning comes from lateCancelIfNow; confirming cancels', async ({
    page,
  }) => {
    test.slow();
    const { bk } = await setup(page);
    bk.booking = bookingView({
      actions: { ...(bookingView().actions as Record<string, unknown>), lateCancelIfNow: true },
    });
    await page.goto(`/booking/${BOOKING_ID}`);
    await page.getByRole('button', { name: 'Cancel booking' }).click();
    const sheet = page.getByRole('dialog', { name: 'Cancel your seat?' });
    await expect(sheet.getByText('Radu will be told.')).toBeVisible();
    await expect(
      sheet.getByText(
        'Cancelling within 30 minutes of departure counts as a late cancellation on your profile.',
      ),
    ).toBeVisible();
    await expectNoAxeViolations(page);
    await sheet.getByRole('button', { name: 'Cancel booking' }).click();
    await expect(page.getByText('Booking cancelled')).toBeVisible();
    await expect(page.getByText('You cancelled this booking').first()).toBeVisible();
    expect(bk.cancels).toBe(1);
    await expect(page.getByRole('link', { name: 'Call Radu' })).toHaveCount(0);
  });

  test('cancel sheet: no late warning for an early cancel, and a keep button', async ({ page }) => {
    const { bk } = await setup(page);
    bk.booking = bookingView();
    await page.goto(`/booking/${BOOKING_ID}`);
    await page.getByRole('button', { name: 'Cancel booking' }).click();
    const sheet = page.getByRole('dialog', { name: 'Cancel your seat?' });
    await expect(sheet.getByText(/late cancellation/)).toHaveCount(0);
    await sheet.getByRole('button', { name: 'Keep my seat' }).click();
    await expect(sheet).toBeHidden();
    expect(bk.cancels).toBe(0);
  });

  test('cancel refused (INVALID_STATE) shows the reason inside the sheet', async ({ page }) => {
    const { bk } = await setup(page);
    bk.booking = bookingView();
    bk.failNextCancel = 'INVALID_STATE';
    await page.goto(`/booking/${BOOKING_ID}`);
    await page.getByRole('button', { name: 'Cancel booking' }).click();
    const sheet = page.getByRole('dialog', { name: 'Cancel your seat?' });
    await sheet.getByRole('button', { name: 'Cancel booking' }).click();
    await expect(sheet.getByRole('alert')).toContainText('can’t be changed any more');
  });

  test('unknown booking: not found with a way back; the driver is sent to the driver screen', async ({
    page,
  }) => {
    const { bk } = await setup(page);
    await page.goto(`/booking/${BOOKING_ID}`);
    await expect(page.getByRole('heading', { name: 'This page doesn’t exist.' })).toBeVisible();
    bk.booking = bookingView({ viewerRole: 'driver', rideId: OWNER_RIDE_ID });
    await page.goto(`/booking/${BOOKING_ID}`);
    await expect(page).toHaveURL(new RegExp(`/driving/${OWNER_RIDE_ID}$`));
  });
});

test.describe('riding list (4.4) and badges (4.6)', () => {
  test('upcoming and past booking cards link to the booking; empty states', async ({ page }) => {
    test.slow();
    const { bk } = await setup(page);
    bk.upcoming = [
      listItem({ unseen: true, status: 'confirmed', priceBani: 260 }),
      listItem({ id: 'b-2', status: 'requested' }),
    ];
    bk.past = [listItem({ id: 'b-3', status: 'rejected', unseen: false })];
    await page.goto('/rides');
    await expect(page.getByRole('tab', { name: 'Riding' })).toHaveAttribute(
      'aria-selected',
      'true',
    );
    const cards = page.getByRole('link', { name: /Șelimbăr, Shopping City area/ });
    await expect(cards).toHaveCount(2);
    await expect(cards.first()).toContainText('Accepted');
    await expect(cards.first()).toContainText('New update');
    await expect(cards.first()).toContainText('2.60 RON');
    await expect(cards.last()).toContainText('Waiting for answer');
    await expect(cards.last()).toContainText('Up to');
    await expectNoAxeViolations(page);

    await cards.first().click();
    await expect(page).toHaveURL(new RegExp(`/booking/${BOOKING_ID}$`));

    await page.goBack();
    await page.getByRole('tab', { name: 'Past' }).click();
    await expect(page.getByRole('link', { name: /Șelimbăr/ })).toContainText('Declined');

    bk.past = [];
    await page.reload();
    await page.getByRole('tab', { name: 'Past' }).click();
    await expect(page.getByText('No past bookings yet.', { exact: false })).toBeVisible();
    bk.upcoming = [];
    await page.getByRole('tab', { name: 'Upcoming' }).click();
    await expect(heading(page, 'No rides booked yet', 2)).toBeVisible();
  });

  test('the My rides tab carries requests plus unseen updates, as a number and as spoken words', async ({
    page,
  }) => {
    const { bk } = await setup(page);
    bk.summary = { driverPendingRequests: 2, passengerUnseenUpdates: 1, nextRide: null };
    await page.goto('/rides');
    const tab = page.getByRole('link', { name: /My rides/ });
    await expect(tab).toContainText('3');
    await expect(page.getByRole('link', { name: /My rides.*3 updates/ })).toBeVisible();
    // No updates: no badge and nothing extra to hear.
    bk.summary = { driverPendingRequests: 0, passengerUnseenUpdates: 0, nextRide: null };
    await page.reload();
    await expect(page.getByRole('link', { name: 'My rides', exact: true })).toBeVisible();
  });

  test('error state: says what happened and Try again recovers', async ({ page }) => {
    const { bk } = await setup(page);
    let calls = 0;
    await page.route('**/api/v1/me/bookings*', async (route) => {
      calls += 1;
      if (calls <= 2) return route.fulfill({ status: 503, json: { error: { code: 'INTERNAL' } } });
      return route.fulfill({ json: { items: [listItem()], nextCursor: null } });
    });
    void bk;
    await page.goto('/rides');
    await expect(page.getByRole('alert')).toBeVisible({ timeout: 15_000 });
    await page.getByRole('button', { name: 'Try again' }).click();
    await expect(page.getByRole('link', { name: /Șelimbăr/ })).toBeVisible();
  });
});

test.describe('driver requests (4.5)', () => {
  test("accept: the passenger moves to the list with Call and WhatsApp; the badge count is the API's", async ({
    page,
  }) => {
    test.slow();
    const { bk } = await setup(page);
    await page.goto(`/driving/${OWNER_RIDE_ID}`);
    await expect(heading(page, 'Requests', 2)).toBeVisible();
    const first = page.getByRole('listitem', { name: 'Request from Mihai' });
    await expect(first).toContainText('Șelimbăr, Shopping City area to Zona Industrială Vest');
    await expect(first).toContainText('Pays 3.10 RON if you accept');
    await expect(first).toContainText(/Answer by \d\d:\d\d/);
    await expect(page.getByRole('listitem', { name: 'Request from Elena' })).toContainText(
      'Pays 1.70 RON',
    );
    await expectNoAxeViolations(page);

    await first.getByRole('button', { name: 'Accept' }).click();
    await expect(page.getByText('Mihai accepted')).toBeVisible();
    expect(bk.approved).toEqual([REQUEST_A]);
    await expect(page.getByRole('listitem', { name: 'Request from Mihai' })).toHaveCount(0);
    await expect(page.getByRole('heading', { name: 'Passengers', exact: true })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Call Mihai' })).toHaveAttribute(
      'href',
      'tel:+40721234567',
    );
    await expect(page.getByRole('link', { name: 'Message Mihai on WhatsApp' })).toHaveAttribute(
      'href',
      'https://wa.me/40721234567',
    );
    await expect(page.getByText('1 of 3 seats taken')).toBeVisible();
  });

  test('decline removes the request', async ({ page }) => {
    const { bk } = await setup(page);
    await page.goto(`/driving/${OWNER_RIDE_ID}`);
    await page
      .getByRole('listitem', { name: 'Request from Elena' })
      .getByRole('button', { name: 'Decline' })
      .click();
    await expect(page.getByText('Request declined')).toBeVisible();
    expect(bk.rejected).toHaveLength(1);
    await expect(page.getByRole('listitem', { name: 'Request from Elena' })).toHaveCount(0);
  });

  test('RIDE_FULL and REQUEST_EXPIRED are explained on the card', async ({ page }) => {
    const { bk } = await setup(page);
    await page.goto(`/driving/${OWNER_RIDE_ID}`);
    const card = page.getByRole('listitem', { name: 'Request from Mihai' });
    bk.failNextApprove = 'RIDE_FULL';
    await card.getByRole('button', { name: 'Accept' }).click();
    await expect(card.getByRole('alert')).toContainText('All seats are taken.');
    bk.failNextApprove = 'REQUEST_EXPIRED';
    await card.getByRole('button', { name: 'Accept' }).click();
    await expect(card.getByRole('alert')).toContainText('This request has expired.');
  });

  test('a full ride cannot accept more', async ({ page }) => {
    const { bk } = await setup(page);
    bk.owner = { ...bk.owner, seatsBooked: 3 };
    await page.goto(`/driving/${OWNER_RIDE_ID}`);
    const card = page.getByRole('listitem', { name: 'Request from Mihai' });
    await expect(card.getByRole('button', { name: 'Accept' })).toBeDisabled();
    await expect(card.getByText('Ride is full')).toBeVisible();
    await expect(card.getByRole('button', { name: 'Decline' })).toBeEnabled();
  });

  test('a passenger with a hidden phone shows no links', async ({ page }) => {
    const { bk } = await setup(page);
    bk.owner = {
      ...bk.owner,
      requests: [],
      seatsBooked: 1,
      passengers: [
        {
          bookingId: REQUEST_A,
          status: 'confirmed',
          passenger: {
            ...((bk.owner.requests as Array<Record<string, unknown>>)[0]!.passenger as object),
          },
          pickup: {
            point: { lat: 45.7595, lng: 24.2128, approx: true, radiusM: 300 },
            label: 'Șelimbăr',
          },
          dropoff: {
            point: { lat: 45.7926, lng: 24.0973, approx: true, radiusM: 300 },
            label: 'ZI Vest',
          },
          phoneE164: null,
          priceLockedBani: 310,
          finalPriceBani: null,
          canMarkNoShow: false,
          canRate: false,
        },
      ],
    };
    await page.goto(`/driving/${OWNER_RIDE_ID}`);
    await expect(page.getByText('Phone number hidden')).toBeVisible();
    await expect(page.getByRole('link', { name: /Call/ })).toHaveCount(0);
  });
});

test.describe('reduced motion', () => {
  test('the price-drop pulse and the launch run without animation', async ({ page }) => {
    test.slow();
    const { bk } = await setup(page);
    await page.emulateMedia({ reducedMotion: 'reduce' });
    bk.booking = bookingView();
    await page.goto(`/booking/${BOOKING_ID}`);
    await expect(page.getByText('Price dropped to 2.60 RON')).toBeVisible();
    // The sentence carries the message; the ring is decoration and does not animate.
    const anim = await page
      .locator('.drop-dot')
      .evaluate((el) => getComputedStyle(el, '::after').animationName);
    expect(anim).toBe('none');
    const dot = await page
      .locator('.drop-dot')
      .evaluate((el) => getComputedStyle(el).animationName);
    expect(dot).toBe('none');

    // The launch resolves straight to the confirmed state: no wordmark, still navigates.
    bk.booking = null;
    await page.goto(`/ride/${RIDE_ID}`);
    await page.getByRole('button', { name: 'Request seat' }).click();
    await page.getByRole('dialog').getByRole('button', { name: 'Send request' }).click();
    await expect(page).toHaveURL(new RegExp(`/booking/${BOOKING_ID}$`), { timeout: 15_000 });
  });
});

for (const theme of ['dark', 'light'] as const) {
  test.describe(`axe, ${theme} theme at 360x800`, () => {
    test('request sheet', async ({ page }) => {
      test.slow();
      await setup(page, theme);
      await openSheet(page);
      await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
      await expectNoAxeViolations(page);
    });

    test('booking detail: requested and confirmed', async ({ page }) => {
      test.slow();
      const { bk } = await setup(page, theme);
      bk.booking = requestedView();
      await page.goto(`/booking/${BOOKING_ID}`);
      await expect(page.getByText('Waiting for Radu')).toBeVisible();
      await expectNoAxeViolations(page);
      bk.booking = bookingView();
      await page.reload();
      await expect(page.getByText('Radu accepted your request')).toBeVisible();
      await expectNoAxeViolations(page);
    });

    test('riding list', async ({ page }) => {
      const { bk } = await setup(page, theme);
      bk.upcoming = [listItem({ unseen: true, status: 'confirmed' }), listItem({ id: 'b-2' })];
      bk.summary = { driverPendingRequests: 1, passengerUnseenUpdates: 1, nextRide: null };
      await page.goto('/rides');
      await expect(page.getByRole('link', { name: /Șelimbăr/ }).first()).toBeVisible();
      await expectNoAxeViolations(page);
    });

    test('driver ride with requests and a passenger', async ({ page }) => {
      test.slow();
      const { bk } = await setup(page, theme);
      await page.goto(`/driving/${OWNER_RIDE_ID}`);
      await page
        .getByRole('listitem', { name: 'Request from Mihai' })
        .getByRole('button', { name: 'Accept' })
        .click();
      await expect(page.getByRole('link', { name: 'Call Mihai' })).toBeVisible();
      expect(bk.owner.requests).toHaveLength(1);
      await expectNoAxeViolations(page);
    });
  });
}
