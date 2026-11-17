import { test } from '@playwright/test';
import { setupE7 } from './e7-helpers';

/**
 * Screenshots of the E7 admin screens for the PR (docs/screenshots/E7, dark and light, 360x800 and 1280x800). Not a
 * test: runs only with E2E_SCREENSHOTS=1 (`E2E_SCREENSHOTS=1 pnpm exec playwright test tests/e2e/e7-screenshots.spec.ts`).
 */
test.skip(!process.env.E2E_SCREENSHOTS, 'set E2E_SCREENSHOTS=1 to regenerate the E7 screenshots');

const OUT = 'docs/screenshots/E7';

for (const theme of ['dark', 'light'] as const) {
  test(`E7 screens at 360, ${theme}`, async ({ page }) => {
    test.setTimeout(120_000);
    const shot = (name: string, fullPage = true) =>
      page.screenshot({ path: `${OUT}/${name}-${theme}.jpg`, type: 'jpeg', quality: 82, fullPage });
    const settle = (ms = 500) => page.waitForTimeout(ms);
    await setupE7(page, { theme });

    await page.goto('/profile');
    await page.getByRole('region', { name: 'Admin' }).waitFor();
    await settle();
    await page.getByRole('region', { name: 'Admin' }).scrollIntoViewIfNeeded();
    await shot('7.0-settings-admin-row', false);

    await page.goto('/admin');
    await page.getByRole('region', { name: 'Completed shared seats per week' }).waitFor();
    await settle();
    await shot('7.1-metrics');

    await page.goto('/admin/reports');
    await page.getByRole('article', { name: /Report about Radu/ }).waitFor();
    await settle();
    await shot('7.2-reports');
    await page.getByRole('button', { name: 'Suspend account' }).click();
    await page.getByRole('dialog', { name: 'Suspend Radu?' }).waitFor();
    await page.getByRole('dialog').getByRole('button', { name: 'Suspend account' }).click();
    await settle(400);
    await shot('7.2-suspend-sheet-error', false);
    await page.getByLabel('Statement').fill('Repeated unwanted contact after a request to stop.');
    await settle(300);
    await shot('7.2-suspend-sheet', false);
    await page.getByRole('dialog').getByRole('button', { name: 'Suspend account' }).click();
    await page.getByText('Account suspended').waitFor();

    await page.goto('/admin/users');
    await page.getByText('Repeated unwanted contact after a request to stop.').waitFor();
    await settle();
    await shot('7.3-suspended');

    await page.goto('/admin/energy');
    await page.getByRole('heading', { level: 1, name: 'Energy prices' }).waitFor();
    const form = page.locator('form');
    await form.getByLabel(/^Price/).fill('10.080');
    await form.getByLabel(/^Consumption/).fill('6.50');
    await form.getByLabel('Source').fill('Owner check, new supplier');
    await form.getByRole('button', { name: 'Save price' }).click();
    await settle();
    await shot('7.4-energy-large-change');

    await page.goto('/admin/ops');
    await page.getByText('haide-tick').waitFor();
    await settle();
    await shot('7.5-ops');
  });

  test(`E7 screens at 1280, ${theme}`, async ({ page }) => {
    test.setTimeout(120_000);
    await page.setViewportSize({ width: 1280, height: 800 });
    await setupE7(page, { theme });
    const shot = (name: string) =>
      page.screenshot({
        path: `${OUT}/${name}-desktop-${theme}.jpg`,
        type: 'jpeg',
        quality: 82,
        fullPage: true,
      });
    await page.goto('/admin');
    await page.getByRole('region', { name: 'Completed shared seats per week' }).waitFor();
    await page.waitForTimeout(500);
    await shot('7.1-metrics');
    await page.goto('/admin/reports');
    await page.getByRole('article', { name: /Report about Radu/ }).waitFor();
    await page.waitForTimeout(500);
    await shot('7.2-reports');
    await page.goto('/admin/energy');
    await page.getByRole('heading', { level: 1, name: 'Energy prices' }).waitFor();
    await page.waitForTimeout(500);
    await shot('7.4-energy');
  });
}
