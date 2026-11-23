import { test, type Page } from '@playwright/test';
import { pickTime } from './time-helpers';
import { mockAccountApi, seedSession } from './accounts-helpers';
import { mockPlaces, mockRidesApi, newFakeRides, readyDriver } from './rides-helpers';

/**
 * Screenshots of the E2 screens for the PR (docs/screenshots/E2, dark and light). Not a test: runs only with
 * E2E_SCREENSHOTS=1 (`E2E_SCREENSHOTS=1 pnpm exec playwright test tests/e2e/e2-screenshots.spec.ts`).
 */
test.skip(!process.env.E2E_SCREENSHOTS, 'set E2E_SCREENSHOTS=1 to regenerate the E2 screenshots');

const OUT = 'docs/screenshots/E2';

async function pick(page: Page, which: 'From' | 'To', query: string) {
  await page.getByRole('button', { name: new RegExp(`^${which}`) }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByRole('searchbox').fill(query);
  await dialog.getByRole('heading', { name: /places? found/ }).waitFor();
  await dialog.getByRole('listitem').first().getByRole('button').click();
  await dialog.waitFor({ state: 'hidden' });
}

for (const theme of ['dark', 'light'] as const) {
  test(`E2 screens, ${theme}`, async ({ page }) => {
    test.setTimeout(90_000);
    await page.addInitScript((t) => window.localStorage.setItem('haide.theme', t), theme);
    const shot = (name: string, fullPage = true) =>
      page.screenshot({ path: `${OUT}/${name}-${theme}.jpg`, type: 'jpeg', quality: 82, fullPage });

    // 2.1 gate, signed out
    await page.goto('/offer');
    await page.getByRole('heading', { level: 2 }).waitFor();
    await page.waitForTimeout(700);
    await shot('2.1-offer-gate');

    const fake = newFakeRides();
    await seedSession(page);
    await mockAccountApi(page, readyDriver());
    await mockPlaces(page);
    await mockRidesApi(page, fake);

    // 2.2 publish form: empty, then Trip B
    await page.goto('/offer');
    await page.getByRole('button', { name: /^From/ }).waitFor();
    await page.waitForTimeout(700);
    await shot('2.2-publish-empty');
    await pick(page, 'From', 'selimbar');
    await pick(page, 'To', 'zona');
    await page.getByText('9.6 km, about 17 min').waitFor();
    await page.getByLabel('Day', { exact: true }).selectOption({ label: 'Tomorrow' });
    await pickTime(page, 'Leaving at', '07:30');
    await page.waitForTimeout(1400);
    await shot('2.2-publish-tripb');

    // 2.4 ride published
    await page.getByRole('button', { name: 'Publish ride' }).click();
    await page.getByRole('heading', { level: 1, name: 'Ride published' }).waitFor();
    await page.waitForTimeout(2200);
    await shot('2.4-ride-published');

    // 2.6 driver ride + 2.7 cancel sheet
    await page.getByRole('link', { name: 'View my ride' }).click();
    await page.getByRole('heading', { level: 1, name: 'Your ride' }).waitFor();
    await page.waitForTimeout(2200);
    await shot('2.6-driver-ride');
    await page.getByRole('button', { name: 'Cancel ride' }).click();
    await page.waitForTimeout(600);
    await shot('2.7-cancel-sheet', false);
    await page.getByRole('button', { name: 'Keep ride' }).click();

    // 2.5 driving list
    await page.goto('/rides?role=driving');
    await page.getByRole('link', { name: /07:30/ }).waitFor();
    await page.waitForTimeout(500);
    await shot('2.5-driving-list');
  });
}
