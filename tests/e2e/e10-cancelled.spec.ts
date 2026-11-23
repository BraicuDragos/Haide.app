import { expect, test, type Page } from '@playwright/test';
import { expectNoAxeViolations, mockAccountApi, newAccount, seedSession } from './accounts-helpers';
import { listItem, mockBookingsApi, newFakeBookings, type FakeBookings } from './booking-helpers';
import { mockPlaces } from './rides-helpers';
import { mockSearchApi, newFakeSearch } from './search-helpers';

// E10-5, the Cancelled tab in My rides (360x800). The API is mocked: the scope filter is covered by the backend tests.
// These specs check that Past no longer holds cancelled rides, that Cancelled lists them with a badge, who cancelled
// and when, and that no reason is invented.

async function setup(page: Page): Promise<FakeBookings> {
  const bk = newFakeBookings();
  const acc = newAccount();
  acc.me.consent = { upToDate: true, required: [] };
  acc.me.profileComplete = true;
  acc.me.firstName = 'Ioana';
  await page.route('**/telemetry/error', (r) => r.fulfill({ status: 204 }));
  await seedSession(page);
  await mockAccountApi(page, acc);
  await mockPlaces(page);
  await mockSearchApi(page, newFakeSearch());
  await mockBookingsApi(page, bk);
  return bk;
}

const cancelledAt = new Date(Date.now() - 2 * 86_400_000).toISOString();

test.describe('riding: Cancelled tab', () => {
  test('Past excludes cancelled; Cancelled lists them with badge and who cancelled', async ({
    page,
  }) => {
    const bk = await setup(page);
    bk.past = [listItem({ id: 'b-done', status: 'completed' })];
    bk.cancelled = [
      listItem({ id: 'b-me', status: 'cancelled', cancelledBy: 'passenger', cancelledAt }),
      listItem({
        id: 'b-drv',
        status: 'cancelled',
        rideStatus: 'cancelled',
        cancelledBy: 'driver',
        cancelledAt,
      }),
      listItem({
        id: 'b-sys',
        status: 'cancelled',
        rideStatus: 'cancelled',
        cancelledBy: 'system',
        cancelledAt,
      }),
    ];
    await page.goto('/rides');
    await expect(page.getByRole('tab', { name: 'Cancelled' })).toBeVisible();

    await page.getByRole('tab', { name: 'Past' }).click();
    await expect(page.locator('a[href="/booking/b-done"]')).toBeVisible();
    await expect(page.locator('a[href^="/booking/b-me"]')).toHaveCount(0);

    await page.getByRole('tab', { name: 'Cancelled' }).click();
    await expect(page).toHaveURL(/when=cancelled/);
    const me = page.locator('a[href="/booking/b-me"]');
    const drv = page.locator('a[href="/booking/b-drv"]');
    const sys = page.locator('a[href="/booking/b-sys"]');
    await expect(me).toContainText('Cancelled');
    await expect(me).toContainText('You cancelled');
    await expect(me).toContainText('Șelimbăr, Shopping City area');
    await expect(me).toContainText(/\d{2}:\d{2}/);
    await expect(drv).toContainText('Ride cancelled');
    await expect(drv).toContainText('Cancelled by the driver');
    await expect(sys).toContainText('Cancelled by Haide');
    await expect(page.getByText(/reason/i)).toHaveCount(0);
    await expect(page.locator('a[href="/booking/b-done"]')).toHaveCount(0);
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
    );
    expect(overflow).toBe(false);
    await expectNoAxeViolations(page);
  });

  test('keyboard: arrow keys move across the three tabs', async ({ page }) => {
    await setup(page);
    await page.goto('/rides');
    await page.getByRole('tab', { name: 'Upcoming' }).focus();
    await page.keyboard.press('End');
    await expect(page.getByRole('tab', { name: 'Cancelled' })).toHaveAttribute(
      'aria-selected',
      'true',
    );
    await expect(page.getByRole('tab', { name: 'Cancelled' })).toBeFocused();
    await expect(page).toHaveURL(/when=cancelled/);
  });

  test('empty state is calm', async ({ page }) => {
    await setup(page);
    await page.goto('/rides?when=cancelled');
    await expect(page.getByText('No cancelled rides.')).toBeVisible();
    await expectNoAxeViolations(page);
  });

  test('an error offers Try again', async ({ page }) => {
    const bk = await setup(page);
    bk.cancelled = [
      listItem({ id: 'b-me', status: 'cancelled', cancelledBy: 'passenger', cancelledAt }),
    ];
    let fail = true;
    await page.route('**/api/v1/me/bookings?*scope=cancelled*', async (route) => {
      if (fail) {
        return route.fulfill({
          status: 500,
          json: { error: { code: 'UNKNOWN', message: 'x', requestId: 'r' } },
        });
      }
      return route.fallback();
    });
    await page.goto('/rides?when=cancelled');
    await expect(page.getByRole('alert')).toBeVisible();
    fail = false;
    await page.getByRole('button', { name: 'Try again' }).click();
    await expect(page.locator('a[href="/booking/b-me"]')).toBeVisible();
  });
});

test.describe('driving: Cancelled tab', () => {
  test('lists cancelled rides with who cancelled; Past does not', async ({ page }) => {
    await setup(page);
    const when = new Date(Date.now() + 86_400_000).toISOString();
    const item = (id: string, status: string, by: string | null) => ({
      id,
      departureAt: when,
      originLabel: 'Șelimbăr',
      destinationLabel: 'Zona Industrială Vest',
      status,
      seatsOffered: 3,
      seatsBooked: 0,
      pendingRequests: 0,
      toRate: 0,
      seriesId: null,
      cancelledAt: status === 'cancelled' ? cancelledAt : null,
      cancelledBy: by,
    });
    await page.route('**/api/v1/me/rides?*', async (route) => {
      const scope = new URL(route.request().url()).searchParams.get('scope');
      const items =
        scope === 'cancelled'
          ? [item('r-1', 'cancelled', 'driver'), item('r-2', 'cancelled', 'system')]
          : scope === 'past'
            ? [item('r-3', 'completed', null)]
            : [];
      return route.fulfill({ json: { items, nextCursor: null } });
    });
    await page.goto('/rides?role=driving&when=past');
    await expect(page.locator('a[href="/driving/r-3"]')).toBeVisible();
    await expect(page.locator('a[href="/driving/r-1"]')).toHaveCount(0);

    await page.getByRole('tab', { name: 'Cancelled' }).click();
    await expect(page.locator('a[href="/driving/r-1"]')).toContainText('Ride cancelled');
    await expect(page.locator('a[href="/driving/r-1"]')).toContainText('You cancelled this ride');
    await expect(page.locator('a[href="/driving/r-2"]')).toContainText('Cancelled by Haide');
    await expectNoAxeViolations(page);
  });
});
