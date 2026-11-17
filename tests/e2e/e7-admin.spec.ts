import { readFileSync, readdirSync } from 'node:fs';
import { gzipSync } from 'node:zlib';
import { expect, test, type Page } from '@playwright/test';
import { expectNoAxeViolations } from './accounts-helpers';
import { setupE7 } from './e7-helpers';

// E7 (metrics and admin), web side. The API is mocked: the gates, the metric SQL, the audit rows and the guards are
// covered by the backend suites. These specs check what an admin sees and sends at 360x800, dark and light.

const SCREENS: Array<{ path: string; h1: string }> = [
  { path: '/admin', h1: 'Metrics' },
  { path: '/admin/reports', h1: 'Reports' },
  { path: '/admin/users', h1: 'Suspended accounts' },
  { path: '/admin/energy', h1: 'Energy prices' },
  { path: '/admin/ops', h1: 'Ops' },
];

async function noHorizontalScroll(page: Page) {
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow).toBeLessThanOrEqual(0);
}

for (const theme of ['dark', 'light'] as const) {
  test.describe(`E7 admin, ${theme}`, () => {
    test('Admin row shows for admins only, and a non-admin /admin is not found', async ({
      page,
    }) => {
      await setupE7(page, { theme });
      await page.goto('/profile');
      const section = page.getByRole('region', { name: 'Admin' });
      await expect(
        section.getByRole('link', { name: 'Metrics, reports and prices' }),
      ).toBeVisible();
      await section.getByRole('link').click();
      await expect(page).toHaveURL(/\/admin$/);
      await expect(page.getByRole('heading', { level: 1, name: 'Metrics' })).toBeFocused();
    });

    test('a regular user sees no Admin row and /admin is the not-found screen', async ({
      page,
    }) => {
      const { calls } = await setupE7(page, { theme, role: 'user' });
      await page.goto('/profile');
      await expect(page.getByRole('heading', { level: 1, name: 'Profile' })).toBeVisible();
      await expect(page.getByRole('region', { name: 'Admin' })).toHaveCount(0);
      await page.goto('/admin');
      await expect(
        page.getByRole('heading', { level: 1, name: 'This page doesn’t exist' }),
      ).toBeVisible();
      await expectNoAxeViolations(page);
      expect(calls.adminRequests).toBe(0);
    });

    test('Metrics: seven tiles with text status, week navigation, table alternative, partial notice', async ({
      page,
    }) => {
      const { calls } = await setupE7(page, { theme });
      await page.goto('/admin');
      await expect(page.getByRole('heading', { level: 1, name: 'Metrics' })).toBeVisible();
      await expect(page.getByText('Week 47 · 16–22 Nov 2026')).toBeVisible();
      await expect(page.getByText(/Partial week/)).toBeVisible();

      const ns = page.getByRole('region', { name: 'Completed shared seats per week' });
      await expect(ns).toContainText('64');
      await expect(ns).toContainText('Target 100 or more, kill line below 30');
      await ns.getByText('Show as table').click();
      await expect(ns.getByRole('table', { name: /last 12 weeks/ })).toBeVisible();
      await expect(ns.getByRole('row')).toHaveCount(13); // header + 12 weeks

      // Status is words plus an icon, never colour alone
      const tile = (n: string) => page.getByRole('article', { name: n });
      await expect(tile('Search match rate (launch corridors)')).toContainText('34.2 %');
      await expect(tile('Search match rate (launch corridors)')).toContainText('On target');
      await expect(tile('Cancellation rate')).toContainText('Below kill line');
      await expect(tile('Ride fill rate')).toContainText('Watch');
      await expect(tile('Median request response time')).toContainText('11.4 min');
      await expect(tile('4-week passenger retention')).toContainText(
        'Provisional: the 28-day window is still open.',
      );
      await expect(tile('Reports per 100 completed rides')).toContainText('2.1');
      await expect(page.getByRole('table', { name: /per corridor/ })).toContainText('Campus');
      await expect(page.getByText('Mihai')).toBeVisible();
      await expectNoAxeViolations(page);
      await noHorizontalScroll(page);

      // Week navigation: previous week is not partial, next is disabled again on the current week
      const next = page.getByRole('button', { name: 'Next week' });
      await expect(next).toBeDisabled();
      await page.getByRole('button', { name: 'Previous week' }).click();
      await expect(page.getByText('Week 46 · 9–15 Nov 2026')).toBeVisible();
      await expect(page).toHaveURL(/week=2026-W46/);
      await expect(page.getByText(/Partial week/)).toHaveCount(0);
      // 2026-W46 is the first week with data: Previous stops there
      await expect(page.getByRole('button', { name: 'Previous week' })).toBeDisabled();
      await page.getByRole('button', { name: 'This week' }).click();
      await expect(page.getByText('Week 47 · 16–22 Nov 2026')).toBeVisible();
      expect(calls.metricsWeeks).toContain('2026-W46');
      // touch targets
      for (const name of ['Previous week', 'This week']) {
        const box = await page.getByRole('button', { name }).boundingBox();
        expect(box!.height).toBeGreaterThanOrEqual(44);
        expect(box!.width).toBeGreaterThanOrEqual(44);
      }
    });

    test('Metrics error state retries', async ({ page }) => {
      await setupE7(page, { theme, metricsFail: true });
      await page.goto('/admin');
      await expect(page.getByRole('alert')).toContainText('That didn’t work');
      await page.getByRole('button', { name: 'Try again' }).click();
      await expect(
        page.getByRole('region', { name: 'Completed shared seats per week' }),
      ).toBeVisible();
    });

    test('Reports: suspend from a report needs a statement, sends the code and the report, then updates the row', async ({
      page,
    }) => {
      const { calls } = await setupE7(page, { theme });
      await page.goto('/admin/reports');
      const card = page.getByRole('article', { name: /Report about Radu/ });
      await expect(card).toContainText('Harassment');
      await expect(card).toContainText('2 open, 2 in 90 days');
      await expect(card).toContainText('Report dismissed by Dragoș');
      await expectNoAxeViolations(page);
      await noHorizontalScroll(page);

      await card.getByRole('button', { name: 'Suspend account' }).click();
      const sheet = page.getByRole('dialog', { name: 'Suspend Radu?' });
      await expect(sheet).toBeVisible();
      await expect(
        sheet.getByText('The person will see this. Do not name who reported them.'),
      ).toBeVisible();
      await expect(sheet.getByLabel('Reason')).toHaveValue('harassment'); // pre-filled from the report
      await expectNoAxeViolations(page);

      // Required statement: too short is refused and nothing is sent
      await sheet.getByRole('button', { name: 'Suspend account' }).click();
      await expect(sheet.getByRole('alert')).toContainText('Write between 10 and 300 characters.');
      expect(calls.suspend).toEqual([]);

      await sheet
        .getByLabel('Statement')
        .fill('Repeated unwanted contact after a request to stop.');
      await sheet.getByRole('button', { name: 'Suspend account' }).click();
      await expect(page.getByText('Account suspended')).toBeVisible();
      expect(calls.suspend).toEqual([
        {
          id: 'u-3',
          body: {
            reasonCode: 'harassment',
            statement: 'Repeated unwanted contact after a request to stop.',
            reportId: 'rep-1',
          },
        },
      ]);
      // the open list is refetched: the report is actioned, so it leaves the Open tab
      await expect(page.getByRole('heading', { name: 'No reports here' })).toBeVisible();
      await page.getByRole('radio', { name: 'Actioned' }).check();
      await expect(page.getByRole('article', { name: /Report about Radu/ })).toContainText(
        'Suspended',
      );

      // Suspended list, then Unsuspend
      await page.getByRole('link', { name: 'Suspended' }).click();
      await expect(
        page.getByRole('heading', { level: 1, name: 'Suspended accounts' }),
      ).toBeFocused();
      await expect(
        page.getByText('Repeated unwanted contact after a request to stop.'),
      ).toBeVisible();
      await page.getByRole('button', { name: 'Unsuspend account' }).click();
      const un = page.getByRole('dialog', { name: 'Unsuspend Radu?' });
      await expect(un.getByText(/stay cancelled/)).toBeVisible();
      await un.getByLabel(/Note for the record/).fill('Appeal accepted');
      await un.getByRole('button', { name: 'Unsuspend account' }).click();
      await expect(page.getByText('Account unsuspended')).toBeVisible();
      expect(calls.unsuspend).toEqual([{ id: 'u-3', body: { note: 'Appeal accepted' } }]);
      await expect(page.getByRole('heading', { name: 'No one is suspended' })).toBeVisible();
    });

    test('Reports: a statement refused for contact details says why', async ({ page }) => {
      await setupE7(page, { theme });
      // Registered after the helper's routes, so it wins (Playwright matches the last route first).
      await page.route('**/admin/users/*/suspend', (route) =>
        route.fulfill({
          status: 400,
          contentType: 'application/json',
          body: JSON.stringify({
            error: {
              code: 'VALIDATION_FAILED',
              message: 'Check the statement.',
              fields: { statement: 'contact_details' },
            },
          }),
        }),
      );
      await page.goto('/admin/reports');
      await page
        .getByRole('article', { name: /Report about Radu/ })
        .getByRole('button', { name: 'Suspend account' })
        .click();
      const sheet = page.getByRole('dialog', { name: 'Suspend Radu?' });
      await sheet.getByLabel('Statement').fill('Please ring him on 0721 234 567 about the rules.');
      await sheet.getByRole('button', { name: 'Suspend account' }).click();
      await expect(sheet.getByText(/phone number, an email, a plate or a location/)).toBeVisible();
      await expectNoAxeViolations(page);
    });

    test('Reports: dismiss asks first, sends the note, and the report leaves the open list', async ({
      page,
    }) => {
      const { calls } = await setupE7(page, { theme });
      await page.goto('/admin/reports');
      await page.getByRole('button', { name: 'Dismiss report' }).click();
      const sheet = page.getByRole('dialog', { name: 'Dismiss this report?' });
      await expect(sheet.getByText(/nobody is emailed/)).toBeVisible();
      await sheet.getByLabel(/Note for the record/).fill('Single message, no pattern');
      await sheet.getByRole('button', { name: 'Dismiss report' }).click();
      await expect(page.getByText('Report dismissed', { exact: true }).first()).toBeVisible();
      expect(calls.dismiss).toEqual([
        { id: 'rep-1', body: { note: 'Single message, no pattern' } },
      ]);
      await expect(page.getByRole('heading', { name: 'No reports here' })).toBeVisible();
      // Esc closes a sheet and focus returns to the opener
      await page.getByRole('radio', { name: 'Dismissed' }).check();
      const card = page.getByRole('article', { name: /Report about Radu/ });
      const opener = card.getByRole('button', { name: 'Suspend account' });
      await opener.click();
      await expect(page.getByRole('dialog', { name: 'Suspend Radu?' })).toBeVisible();
      await page.keyboard.press('Escape');
      await expect(page.getByRole('dialog')).toHaveCount(0);
      await expect(opener).toBeFocused();
    });

    test('Energy: a change over 30 % warns, needs the override, then saves with the flag', async ({
      page,
    }) => {
      const { calls } = await setupE7(page, { theme });
      await page.goto('/admin/energy');
      await expect(page.getByRole('heading', { level: 1, name: 'Energy prices' })).toBeVisible();
      await expect(page.getByRole('article').filter({ hasText: 'Petrol' })).toContainText(
        '7.200 RON/l',
      );
      await expectNoAxeViolations(page);
      await noHorizontalScroll(page);

      const form = page.locator('form');
      await expect(
        form.getByText('Hybrid cars use the petrol price. Add a hybrid version too.'),
      ).toBeVisible();
      // The hint says to add a hybrid version, so Hybrid must be an option (QA: it was missing)
      await expect(form.getByLabel('Fuel').getByRole('option', { name: 'Hybrid' })).toHaveCount(1);
      // +10 %: no warning, live change shown
      await form.getByLabel(/^Price/).fill('7.920');
      await form.getByLabel(/^Consumption/).fill('6.50');
      await expect(
        form.getByText('Change from the latest price: +10 %. Consumption: 0 %.'),
      ).toBeVisible();
      await expect(form.getByText(/% change from the current price/)).toHaveCount(0);

      // +40 %: warning appears, the save is blocked until confirmed
      await form.getByLabel(/^Price/).fill('10.080');
      await expect(
        form.getByText(
          'This is a 40% change from the current price. Check the number before you save.',
        ),
      ).toBeVisible();
      await form.getByLabel('Source').fill('Owner check, new supplier');
      await form.getByRole('button', { name: 'Save price' }).click();
      await expect(form.getByText('Confirm the change to save it.')).toBeVisible();
      expect(calls.energy).toEqual([]);
      await expectNoAxeViolations(page);

      await form.getByLabel('I confirm this change is correct').check();
      await form.getByRole('button', { name: 'Save price' }).click();
      await expect(page.getByText('Energy price added')).toBeVisible();
      expect(calls.energy).toHaveLength(1);
      expect(calls.energy[0]).toMatchObject({
        fuelType: 'petrol',
        priceMilli: 10080,
        consumptionCenti: 650,
        sourceNote: 'Owner check, new supplier',
        overrideLargeChange: true,
      });
      expect(calls.energy[0]).not.toHaveProperty('effectiveFrom');
      await expect(page.getByRole('article').filter({ hasText: 'Petrol' })).toContainText(
        '10.080 RON/l',
      );
    });

    test('Energy: the server LARGE_CHANGE answer shows the same warning even when the UI saw a small change', async ({
      page,
    }) => {
      const { calls } = await setupE7(page, { theme, serverLargeOnce: true });
      await page.goto('/admin/energy');
      const form = page.locator('form');
      await form.getByLabel(/^Price/).fill('7.500');
      await form.getByLabel(/^Consumption/).fill('6.50');
      await form.getByLabel('Source').fill('Pump price list');
      await form.getByRole('button', { name: 'Save price' }).click();
      await expect(form.getByText(/% change from the current price/)).toBeVisible();
      expect(calls.energy).toHaveLength(1);
      await form.getByLabel('I confirm this change is correct').check();
      await form.getByRole('button', { name: 'Save price' }).click();
      await expect(page.getByText('Energy price added')).toBeVisible();
      expect(calls.energy[1]).toMatchObject({ overrideLargeChange: true });
    });

    test('Energy: a scheduled price sends effectiveFrom as a Bucharest instant', async ({
      page,
    }) => {
      const { calls } = await setupE7(page, { theme });
      await page.goto('/admin/energy');
      const form = page.locator('form');
      await form.getByLabel('Fuel').selectOption('electric');
      await form.getByLabel(/^Price/).fill('1.950');
      await form.getByLabel(/^Consumption/).fill('18.00');
      await form.getByRole('radio', { name: 'Pick a date' }).check();
      await form.getByLabel('Starts on').fill('2026-12-01T08:00');
      await form.getByLabel('Source').fill('Tariff update');
      await form.getByRole('button', { name: 'Save price' }).click();
      await expect(page.getByText('Energy price added')).toBeVisible();
      // 08:00 in Bucharest on 1 Dec (UTC+2) is 06:00Z
      expect(calls.energy[0]).toMatchObject({
        fuelType: 'electric',
        effectiveFrom: '2026-12-01T06:00:00.000Z',
      });
    });

    test('Ops shows tiles, cron runs and errors', async ({ page }) => {
      await setupE7(page, { theme });
      await page.goto('/admin/ops');
      await expect(page.getByText('37 / 100')).toBeVisible();
      await expect(page.getByText('haide-tick')).toBeVisible();
      await expect(page.getByText('Failed to fetch')).toBeVisible();
      await expectNoAxeViolations(page);
      await noHorizontalScroll(page);
    });

    test('axe clean on all five screens, empty states included', async ({ page }) => {
      await setupE7(page, { theme, empty: true });
      for (const s of SCREENS) {
        await page.goto(s.path);
        await expect(page.getByRole('heading', { level: 1, name: s.h1 })).toBeVisible();
        await expect(page.getByRole('status').filter({ hasText: 'Loading' })).toHaveCount(0);
        await expectNoAxeViolations(page);
        await noHorizontalScroll(page);
      }
    });
  });
}

test.describe('E7 reduced motion and navigation', () => {
  test('reduced motion: nav works, sheet opens and closes, no animation runs', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await setupE7(page);
    await page.goto('/admin/reports');
    await page.getByRole('button', { name: 'Dismiss report' }).click();
    await expect(page.getByRole('dialog', { name: 'Dismiss this report?' })).toBeVisible();
    const running = await page.evaluate(
      () =>
        document
          .getAnimations()
          .filter(
            (a) =>
              a.playState === 'running' && a.effect?.getComputedTiming().iterations === Infinity,
          ).length,
    );
    expect(running).toBe(0);
    await page.getByRole('button', { name: 'Cancel' }).click();
    await page.getByRole('link', { name: 'Energy prices' }).click();
    await expect(page.getByRole('heading', { level: 1, name: 'Energy prices' })).toBeFocused();
  });

  test('keyboard: the nav marks the current page and is reachable by Tab', async ({ page }) => {
    await setupE7(page);
    await page.goto('/admin');
    const nav = page.getByRole('navigation', { name: 'Admin sections' });
    await expect(nav.getByRole('link', { name: 'Metrics' })).toHaveAttribute(
      'aria-current',
      'page',
    );
    for (const name of ['Metrics', 'Reports', 'Suspended', 'Energy prices', 'Ops']) {
      const box = await nav.getByRole('link', { name }).boundingBox();
      expect(box!.height).toBeGreaterThanOrEqual(44);
    }
  });

  test('desktop: the wide shell shows the side rail at 1280 px', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await setupE7(page);
    await page.goto('/admin');
    const nav = page.getByRole('navigation', { name: 'Admin sections' });
    await expect(nav).toBeVisible();
    const box = await nav.boundingBox();
    expect(box!.width).toBeLessThan(300);
    const main = await page.locator('main').boundingBox();
    expect(main!.width).toBeGreaterThan(1000);
    await noHorizontalScroll(page);
  });
});

test.describe('E7 bundle', () => {
  test('the admin code is lazy and the initial JS stays inside the 200 KB gzip budget', async () => {
    const dist = new URL('../../apps/web/dist/', import.meta.url);
    const html = readFileSync(new URL('index.html', dist), 'utf8');
    const initial = [...html.matchAll(/(?:src|href)="\/(assets\/[^"]+\.js)"/g)].map((m) => m[1]!);
    expect(initial.length).toBeGreaterThan(0);
    const gz = initial.reduce(
      (sum, f) => sum + gzipSync(readFileSync(new URL(f, dist)), { level: 9 }).length,
      0,
    );
    expect(gz).toBeLessThan(200 * 1024);
    // admin screens are their own chunks, never in the initial set
    const all = readdirSync(new URL('assets/', dist));
    for (const name of [
      'AdminLayout',
      'MetricsScreen',
      'ReportsScreen',
      'EnergyScreen',
      'OpsScreen',
    ]) {
      expect(all.some((f) => f.startsWith(name))).toBe(true);
      expect(initial.some((f) => f.includes(name))).toBe(false);
    }
    // and the admin code itself is not inlined in the entry chunk
    for (const f of initial) {
      expect(readFileSync(new URL(f, dist), 'utf8')).not.toContain('/admin/energy-prices');
    }
  });
});
