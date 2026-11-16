import { expect, test, type Page, type Route } from '@playwright/test';
import {
  expectNoAxeViolations,
  mockAccountApi,
  newAccount,
  publicUser,
  seedSession,
} from './accounts-helpers';
import {
  BOOKING_ID,
  bookingView,
  DROPOFF,
  PICKUP,
  mockBookingsApi,
  newFakeBookings,
  OWNER_RIDE_ID,
  ownerRide,
  type FakeBookings,
} from './booking-helpers';
import { DRIVER } from './search-helpers';

// E5 (completion, ratings, safety), web side. The API is mocked: the rules (windows, blind ratings, cascades, tokens)
// are covered by the backend suites. These specs check what the person sees and sends at 360x800 in dark and light.

type Json = Record<string, unknown>;
const TOKEN = 'Zx9_Kq3LmN7pR2sT5vWb0A';
const minutes = (m: number) => new Date(Date.now() + m * 60_000).toISOString();

async function setup(page: Page, theme: 'dark' | 'light' = 'dark'): Promise<FakeBookings> {
  await page.addInitScript((t) => window.localStorage.setItem('haide.theme', t), theme);
  await page.route('**/telemetry/error', (r) => r.fulfill({ status: 204 }));
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
  await mockBookingsApi(page, bk);
  return bk;
}

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

const completed = (over: Json = {}): Json =>
  bookingView({
    status: 'completed',
    rideStatus: 'completed',
    completedAt: minutes(-60),
    price: { quotedBani: 310, lockedBani: 260, finalBani: 260, droppedFromBani: null },
    rating: { given: null, rateUntil: minutes(7 * 24 * 60 - 60) },
    share: null,
    noShowBy: null,
    timeline: [
      { status: 'requested', at: minutes(-300) },
      { status: 'confirmed', at: minutes(-290) },
      { status: 'completed', at: minutes(-60) },
    ],
    actions: actions({ canRate: true }),
    ...over,
  });

/** The driver's side: one accepted passenger, the flags the server computes, and the ride's own 112 window. */
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

for (const theme of ['dark', 'light'] as const) {
  test.describe(`E5 at 360x800, ${theme}`, () => {
    test('rate: stars by keyboard, a tag, one POST, the done state; axe clean', async ({
      page,
    }) => {
      test.slow();
      const bk = await setup(page, theme);
      bk.booking = completed();
      const posts: Json[] = [];
      await page.route(`**/api/v1/bookings/${BOOKING_ID}/ratings`, (r) => {
        posts.push(r.request().postDataJSON() as Json);
        return r.fulfill({
          status: 201,
          json: { stars: 4, tags: ['punctual'], createdAt: new Date().toISOString() },
        });
      });
      await page.goto(`/rate/${BOOKING_ID}`);
      await expect(page.getByRole('heading', { name: 'Rate Radu' })).toBeVisible();
      await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
      // The driver's tags only: no "Respectful" (that is for passengers).
      await expect(page.getByRole('button', { name: 'Clean car' })).toBeVisible();
      await expect(page.getByRole('button', { name: 'Respectful' })).toHaveCount(0);
      await expectNoAxeViolations(page);

      // No stars: a clear error, nothing sent.
      await page.getByRole('button', { name: 'Send rating' }).click();
      await expect(page.getByText('Choose 1 to 5 stars.')).toBeVisible();
      expect(posts).toHaveLength(0);

      await page.getByRole('radio', { name: '3 stars' }).focus();
      await page.keyboard.press('ArrowRight');
      await expect(page.getByRole('radio', { name: '4 stars' })).toBeChecked();
      await page.getByRole('button', { name: 'Punctual' }).click();
      await expect(page.getByRole('button', { name: 'Punctual' })).toHaveAttribute(
        'aria-pressed',
        'true',
      );
      await page.getByRole('button', { name: 'Send rating' }).click();
      await expect(
        page.getByRole('status').getByRole('heading', { name: 'Rating sent' }),
      ).toBeVisible();
      expect(posts).toEqual([{ stars: 4, tags: ['punctual'] }]);
      await expectNoAxeViolations(page);
    });

    test('rate: a window that has closed says so and offers no form', async ({ page }) => {
      const bk = await setup(page, theme);
      bk.booking = completed({
        actions: actions({ canRate: false }),
        rating: { given: null, rateUntil: minutes(-5) },
      });
      await page.goto(`/rate/${BOOKING_ID}`);
      await expect(page.getByText('The time to do this has passed.')).toBeVisible();
      await expect(page.getByRole('button', { name: 'Send rating' })).toHaveCount(0);
    });

    test('Call 112 shows only inside the server window, as a tel: link; axe clean', async ({
      page,
    }) => {
      test.slow();
      const bk = await setup(page, theme);
      bk.booking = bookingView({
        departureAt: minutes(10),
        actions: actions({
          show112: true,
          call112Window: { from: minutes(-5), until: minutes(115) },
        }),
      });
      await page.goto(`/booking/${BOOKING_ID}`);
      const call = page.getByRole('link', { name: 'Call 112, the emergency number' });
      await expect(call).toBeVisible();
      await expect(call).toHaveAttribute('href', 'tel:112');
      await expectNoAxeViolations(page);

      // The same booking an hour before the window opens: no button.
      bk.booking = bookingView({
        departureAt: minutes(120),
        actions: actions({ call112Window: { from: minutes(105), until: minutes(240) } }),
      });
      await page.reload();
      await expect(page.getByText('Radu accepted your request')).toBeVisible();
      await expect(page.getByRole('link', { name: 'Call 112, the emergency number' })).toHaveCount(
        0,
      );
    });

    test('blocked people: list, Unblock sends DELETE and empties the list; axe clean', async ({
      page,
    }) => {
      test.slow();
      await setup(page, theme);
      let items: Json[] = [{ user: DRIVER, blockedAt: minutes(-60 * 24) }];
      const deletes: string[] = [];
      await page.route('**/api/v1/me/blocks', (r) => r.fulfill({ json: { items } }));
      await page.route('**/api/v1/blocks/*', (r) => {
        deletes.push(new URL(r.request().url()).pathname.split('/').pop() ?? '');
        items = [];
        return r.fulfill({ status: 204 });
      });
      await page.goto('/settings/blocked');
      await expect(page.getByRole('heading', { name: 'Blocked people' })).toBeVisible();
      await expect(page.getByText('Radu')).toBeVisible();
      await expectNoAxeViolations(page);
      await page.getByRole('button', { name: 'Unblock Radu' }).click();
      await expect(page.getByText('You haven’t blocked anyone.')).toBeVisible();
      expect(deletes).toEqual([DRIVER.id as string]);
    });

    test('shared trip: no account, no session token sent, read-only; gone link says so', async ({
      page,
    }) => {
      test.slow();
      await page.addInitScript((t) => window.localStorage.setItem('haide.theme', t), theme);
      await page.route('**/telemetry/error', (r) => r.fulfill({ status: 204 }));
      const auth: Array<string | undefined> = [];
      await page.route(`**/api/v1/share/${TOKEN}`, (r) => {
        auth.push(r.request().headers()['authorization']);
        return r.fulfill({
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
        });
      });
      await page.route('**/api/v1/share/GONEGONEGONEGONEGONEGO', (r) =>
        r.fulfill({
          status: 404,
          json: { error: { code: 'NOT_FOUND', message: 'x', requestId: 'r' } },
        }),
      );
      await page.goto(`/s/${TOKEN}`);
      await expect(page.getByText('SB12ABC')).toBeVisible();
      await expect(page.getByText('Not left yet')).toBeVisible();
      await expect(page.getByText('Radu is driving')).toBeVisible();
      await expect(
        page.getByRole('link', { name: 'Call 112, the emergency number' }),
      ).toHaveAttribute('href', 'tel:112');
      // No tab bar, no sign-in prompt, no phone number anywhere on the page.
      await expect(page.getByRole('navigation')).toHaveCount(0);
      expect(await page.locator('body').innerText()).not.toMatch(/\+40|\b07\d{8}\b/);
      // Privacy meta tags while the page is open.
      await expect(page.locator('meta[name="referrer"]')).toHaveAttribute('content', 'no-referrer');
      await expect(page.locator('meta[name="robots"]')).toHaveAttribute('content', /noindex/);
      expect(auth.every((a) => a === undefined)).toBe(true);
      await expectNoAxeViolations(page);

      await page.goto('/s/GONEGONEGONEGONEGONEGO');
      await expect(
        page.getByRole('heading', { name: 'This link no longer works' }).first(),
      ).toBeVisible();
      await expectNoAxeViolations(page);
    });

    test('sheets: share link, no-show and report send the right calls; axe clean', async ({
      page,
    }) => {
      test.slow();
      const bk = await setup(page, theme);
      bk.booking = bookingView({
        departureAt: minutes(-30),
        actions: actions({ canShare: true, canReportDriverNoShow: true }),
      });
      const calls: Array<{ path: string; body: Json | null }> = [];
      const seen = async (r: Route, status: number, json?: Json) => {
        const req = r.request();
        calls.push({
          path: new URL(req.url()).pathname.replace(/^.*\/api\/v1/, ''),
          body: req.method() === 'POST' ? ((req.postDataJSON() as Json | null) ?? null) : null,
        });
        return json ? r.fulfill({ status, json }) : r.fulfill({ status });
      };
      await page.route(`**/api/v1/bookings/${BOOKING_ID}/share-link`, (r) =>
        seen(r, 201, { url: `https://haide.example/s/${TOKEN}`, expiresAt: minutes(24 * 60) }),
      );
      await page.route(`**/api/v1/bookings/${BOOKING_ID}/no-show`, (r) =>
        seen(r, 200, { ...bk.booking, status: 'no_show', noShowBy: 'passenger' }),
      );
      await page.route('**/api/v1/reports', (r) => seen(r, 201, { id: BOOKING_ID }));
      await page.route('**/api/v1/blocks', (r) => seen(r, 204));
      await page.goto(`/booking/${BOOKING_ID}`);

      await page.getByRole('button', { name: 'Share trip link' }).click();
      const share = page.getByRole('dialog', { name: 'Share trip link' });
      await expect(share).toBeVisible();
      await expectNoAxeViolations(page);
      await share.getByRole('button', { name: 'Create link' }).click();
      await expect(share.locator(`input[value$="/s/${TOKEN}"]`)).toBeVisible();
      expect(calls.at(-1)).toMatchObject({ path: `/bookings/${BOOKING_ID}/share-link` });
      await page.keyboard.press('Escape');
      await expect(share).toBeHidden();

      await page.getByRole('button', { name: 'Driver didn’t show' }).click();
      const noShow = page.getByRole('dialog', { name: /didn’t show/ });
      await expect(noShow).toBeVisible();
      await expectNoAxeViolations(page);
      await page.keyboard.press('Escape');
      await expect(noShow).toBeHidden();

      await page.getByRole('button', { name: 'Report a problem' }).click();
      const report = page.getByRole('dialog', { name: /Report/ });
      await expect(report).toBeVisible();
      await report.getByRole('button', { name: 'Send report' }).click();
      await expect(report.getByText('Choose a reason.')).toBeVisible();
      await report.getByRole('radio', { name: 'Other' }).check({ force: true });
      await report.getByRole('button', { name: 'Send report' }).click();
      await expect(report.getByText('Tell us what happened.').first()).toBeVisible();
      await report.getByLabel('Details').fill('Asked me to pay more in cash');
      await report.getByRole('checkbox', { name: /Also block/ }).check({ force: true });
      await expectNoAxeViolations(page);
      await report.getByRole('button', { name: 'Send report' }).click();
      await expect(page.getByText('Report sent').first()).toBeVisible();
      const sent = calls.find((c) => c.path === '/reports');
      expect(sent?.body).toMatchObject({
        reason: 'other',
        details: 'Asked me to pay more in cash',
        bookingId: BOOKING_ID,
        alsoBlock: true,
      });
      expect(sent?.body).not.toHaveProperty('phone');
      await expectNoAxeViolations(page);
    });

    test('driver: Call 112 inside the window, Mark no-show sends one POST and shows the state; axe clean', async ({
      page,
    }) => {
      test.slow();
      const bk = await setup(page, theme);
      bk.owner = drivingRide({
        departureAt: minutes(-20),
        show112: true,
        call112Window: { from: minutes(-35), until: minutes(100) },
        passengers: [paxRow({ canMarkNoShow: true })],
      });
      const posts: string[] = [];
      await page.route(`**/api/v1/bookings/${BOOKING_ID}/no-show`, (r) => {
        posts.push(r.request().method());
        bk.owner = drivingRide({
          departureAt: minutes(-20),
          passengers: [
            paxRow({
              status: 'no_show',
              noShowBy: 'driver',
              phoneE164: null,
              priceLockedBani: null,
            }),
          ],
        });
        return r.fulfill({ json: bk.owner });
      });
      await page.goto(`/driving/${OWNER_RIDE_ID}`);
      const call = page.getByRole('link', { name: 'Call 112, the emergency number' });
      await expect(call).toBeVisible();
      await expect(call).toHaveAttribute('href', 'tel:112');
      await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
      await expectNoAxeViolations(page);

      await page.getByRole('button', { name: 'Mark no-show for Ioana' }).click();
      const sheet = page.getByRole('dialog', { name: 'Mark Ioana as a no-show?' });
      await expect(sheet).toBeVisible();
      await expectNoAxeViolations(page);
      // Backing out sends nothing.
      await sheet.getByRole('button', { name: 'Not a no-show' }).click();
      await expect(sheet).toBeHidden();
      expect(posts).toHaveLength(0);

      await page.getByRole('button', { name: 'Mark no-show for Ioana' }).click();
      await sheet.getByRole('button', { name: 'Mark no-show', exact: true }).click();
      await expect(page.getByText('You marked Ioana as a no-show.')).toBeVisible();
      await expect(page.getByText('Marked as a no-show', { exact: true })).toBeVisible();
      await expect(page.getByRole('button', { name: /Mark no-show for/ })).toHaveCount(0);
      expect(posts).toEqual(['POST']);
      await expectNoAxeViolations(page);
    });

    test('driver: no Call 112 outside the window; a passenger report shows the banner', async ({
      page,
    }) => {
      const bk = await setup(page, theme);
      bk.owner = drivingRide({
        departureAt: minutes(-60 * 5),
        call112Window: { from: minutes(-60 * 5 - 15), until: minutes(-180) },
        passengers: [paxRow({ status: 'no_show', noShowBy: 'passenger', phoneE164: null })],
      });
      await page.goto(`/driving/${OWNER_RIDE_ID}`);
      await expect(
        page.getByText('Ioana reported that you didn’t show. If that’s wrong, report a problem.'),
      ).toBeVisible();
      await expect(page.getByRole('link', { name: 'Call 112, the emergency number' })).toHaveCount(
        0,
      );
      await expectNoAxeViolations(page);
    });

    test('driver: a finished ride offers Rate, which opens the Rate screen with passenger tags; axe clean', async ({
      page,
    }) => {
      test.slow();
      const bk = await setup(page, theme);
      bk.owner = drivingRide({
        status: 'completed',
        departureAt: minutes(-120),
        completedAt: minutes(-60),
        passengers: [paxRow({ status: 'completed', canRate: true, rateUntil: minutes(9000) })],
      });
      bk.booking = bookingView({
        viewerRole: 'driver',
        status: 'completed',
        rideStatus: 'completed',
        completedAt: minutes(-60),
        rating: { given: null, rateUntil: minutes(9000) },
        actions: actions({ canRate: true }),
      });
      const posts: Json[] = [];
      await page.route(`**/api/v1/bookings/${BOOKING_ID}/ratings`, (r) => {
        posts.push(r.request().postDataJSON() as Json);
        return r.fulfill({
          status: 201,
          json: { stars: 5, tags: ['respectful'], createdAt: new Date().toISOString() },
        });
      });
      await page.goto(`/driving/${OWNER_RIDE_ID}`);
      await expect(
        page.getByText('This ride is done. You can rate your passengers for 7 days.'),
      ).toBeVisible();
      await expect(page.getByText('Ride completed')).toBeVisible();
      await expectNoAxeViolations(page);

      await page.getByRole('link', { name: 'Rate Ioana' }).click();
      await expect(page.getByRole('heading', { name: 'Rate Ioana' })).toBeVisible();
      await expect(page.getByRole('button', { name: 'Respectful' })).toBeVisible();
      await expect(page.getByRole('button', { name: 'Clean car' })).toHaveCount(0);
      await page.getByRole('radio', { name: '5 stars' }).check({ force: true });
      await page.getByRole('button', { name: 'Respectful' }).click();
      await page.getByRole('button', { name: 'Send rating' }).click();
      await expect(
        page.getByRole('status').getByRole('heading', { name: 'Rating sent' }),
      ).toBeVisible();
      expect(posts).toEqual([{ stars: 5, tags: ['respectful'] }]);
      await expectNoAxeViolations(page);
    });

    test('driver: report and block a passenger send the right calls; axe clean', async ({
      page,
    }) => {
      test.slow();
      const bk = await setup(page, theme);
      bk.owner = drivingRide({ departureAt: minutes(-30) });
      const calls: Array<{ path: string; body: Json | null }> = [];
      await page.route('**/api/v1/reports', (r) => {
        calls.push({ path: '/reports', body: r.request().postDataJSON() as Json });
        return r.fulfill({ status: 201, json: { id: BOOKING_ID } });
      });
      await page.route('**/api/v1/blocks', (r) => {
        calls.push({ path: '/blocks', body: r.request().postDataJSON() as Json });
        return r.fulfill({ status: 204 });
      });
      await page.goto(`/driving/${OWNER_RIDE_ID}`);

      await page.getByRole('button', { name: 'Report Ioana' }).click();
      const report = page.getByRole('dialog', { name: 'Report Ioana' });
      await expect(report).toBeVisible();
      await report.getByRole('radio', { name: 'Harassment' }).check({ force: true });
      await expectNoAxeViolations(page);
      await report.getByRole('button', { name: 'Send report' }).click();
      await expect(page.getByText('Report sent').first()).toBeVisible();
      expect(calls[0]).toMatchObject({
        path: '/reports',
        body: { reportedUserId: 'u-1', reason: 'harassment', bookingId: BOOKING_ID },
      });
      await page.keyboard.press('Escape');
      await expect(report).toBeHidden();

      await page.getByRole('button', { name: 'Block Ioana' }).click();
      const block = page.getByRole('dialog', { name: 'Block Ioana?' });
      await expect(block).toBeVisible();
      await expectNoAxeViolations(page);
      await block.getByRole('button', { name: 'Block Ioana' }).click();
      await expect(page.getByText('Ioana is blocked').first()).toBeVisible();
      expect(calls.at(-1)).toEqual({ path: '/blocks', body: { userId: 'u-1' } });
      // the driver stays on the ride: the other passengers are still on it
      await expect(page).toHaveURL(new RegExp(`/driving/${OWNER_RIDE_ID}$`));
    });

    test('a suspended account sees the paused screen with a way out', async ({ page }) => {
      await setup(page, theme);
      let meCalls = 0;
      await page.route('**/api/v1/me', (r) => {
        meCalls += 1;
        return r.fulfill({
          status: 403,
          json: { error: { code: 'ACCOUNT_SUSPENDED', message: 'x', requestId: 'r' } },
        });
      });
      await page.goto('/rides');
      await expect(
        page.getByRole('alert').filter({ hasText: 'Your account is paused' }),
      ).toBeVisible();
      await expect(page.getByRole('button', { name: 'Sign out' })).toBeVisible();
      // /me is asked once (plus at most one network retry), never in a loop.
      await page.waitForTimeout(1500);
      expect(meCalls).toBeLessThanOrEqual(3);
      await expectNoAxeViolations(page);
    });
  });
}

test.describe('E5 reduced motion', () => {
  test('the driver screen shows the 112 button and sheets without motion', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    const bk = await setup(page);
    bk.owner = drivingRide({
      departureAt: minutes(-20),
      show112: true,
      call112Window: { from: minutes(-35), until: minutes(100) },
      passengers: [paxRow({ canMarkNoShow: true })],
    });
    await page.goto(`/driving/${OWNER_RIDE_ID}`);
    await expect(page.getByRole('link', { name: 'Call 112, the emergency number' })).toBeVisible();
    await page.getByRole('button', { name: 'Mark no-show for Ioana' }).click();
    const dialog = page.getByRole('dialog', { name: 'Mark Ioana as a no-show?' });
    await expect(dialog).toBeVisible();
    const dur = await dialog.evaluate((el) => {
      const cs = getComputedStyle(el);
      return { anim: parseFloat(cs.animationDuration), tr: parseFloat(cs.transitionDuration) };
    });
    expect(dur.anim).toBeLessThanOrEqual(0.001);
    expect(dur.tr).toBeLessThanOrEqual(0.001);
  });
  test('the rating confirmation does not animate', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    const bk = await setup(page);
    bk.booking = completed();
    await page.route(`**/api/v1/bookings/${BOOKING_ID}/ratings`, (r) =>
      r.fulfill({ status: 201, json: { stars: 5, tags: [], createdAt: new Date().toISOString() } }),
    );
    await page.goto(`/rate/${BOOKING_ID}`);
    await page.getByRole('radio', { name: '5 stars' }).check({ force: true });
    await page.getByRole('button', { name: 'Send rating' }).click();
    const pop = page.locator('.pop-in');
    await expect(pop).toBeVisible();
    const anim = await pop.evaluate((el) => {
      const cs = getComputedStyle(el);
      return { name: cs.animationName, dur: parseFloat(cs.animationDuration) };
    });
    expect(anim.name === 'none' || anim.dur === 0).toBe(true);
  });
});
