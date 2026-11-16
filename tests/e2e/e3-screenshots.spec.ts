import { test, type Page } from '@playwright/test';
import { mockPlaces } from './rides-helpers';
import { mockSearchApi, newFakeSearch, tripBItem } from './search-helpers';

/**
 * Screenshots of the E3 screens for the PR (docs/screenshots/E3, dark and light). Not a test: runs only with
 * E2E_SCREENSHOTS=1 (`E2E_SCREENSHOTS=1 pnpm exec playwright test tests/e2e/e3-screenshots.spec.ts`).
 */
test.skip(!process.env.E2E_SCREENSHOTS, 'set E2E_SCREENSHOTS=1 to regenerate the E3 screenshots');

const OUT = 'docs/screenshots/E3';

async function pick(page: Page, which: 'From' | 'To', query: string) {
  await page.getByRole('button', { name: new RegExp(`^${which}`) }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByRole('searchbox').fill(query);
  await dialog.getByRole('heading', { name: /places? found/ }).waitFor();
  await dialog.getByRole('listitem').first().getByRole('button').click();
  await dialog.waitFor({ state: 'hidden' });
}

for (const theme of ['dark', 'light'] as const) {
  test(`E3 screens, ${theme}`, async ({ page }) => {
    test.setTimeout(90_000);
    await page.addInitScript((t) => window.localStorage.setItem('haide.theme', t), theme);
    const shot = (name: string, fullPage = true) =>
      page.screenshot({ path: `${OUT}/${name}-${theme}.jpg`, type: 'jpeg', quality: 82, fullPage });

    const fake = newFakeSearch();
    await page.route('**/telemetry/error', (r) => r.fulfill({ status: 204 }));
    await mockPlaces(page);
    await mockSearchApi(page, fake);

    // 3.1 Find, filled
    await page.goto('/find');
    await page.getByRole('button', { name: /^From/ }).waitFor();
    await page.waitForTimeout(900);
    await shot('3.1-find-empty');
    await pick(page, 'From', 'selimbar');
    await pick(page, 'To', 'zona');
    await page.getByLabel('Day', { exact: true }).selectOption({ label: 'Tomorrow' });
    await page.getByLabel('Leave around').fill('07:30');
    await shot('3.1-find-filled');

    // 3.2 Results
    await page.getByRole('button', { name: 'Search rides' }).click();
    await page.getByRole('link', { name: /Up to 3\.10 RON/ }).waitFor();
    await page.waitForTimeout(500);
    await shot('3.2-results');

    // 3.3 Ride detail (let the route draw and the match snap play out)
    await page.getByRole('link', { name: /Up to 3\.10 RON/ }).click();
    await page.getByText('Fits your route. 150 m walk to pickup.').waitFor();
    await page.waitForTimeout(2600);
    await shot('3.3-ride-detail');
    await shot('3.3-ride-detail-top', false);

    // 3.2 empty with nearest rides
    fake.items = [];
    fake.nearest = [tripBItem()];
    await page.goto('/find');
    await page.getByRole('button', { name: 'Search rides' }).click();
    await page.getByRole('heading', { name: 'No rides found' }).waitFor();
    await page.waitForTimeout(500);
    await shot('3.2-results-empty');

    // 3.2 error (offline)
    await page.route('**/api/v1/search', (r) => r.abort('internetdisconnected'));
    await page.goto('/find');
    await page.getByRole('button', { name: 'Search rides' }).click();
    await page
      .getByRole('heading', { name: 'We couldn’t load rides' })
      .waitFor({ timeout: 20_000 });
    await shot('3.2-results-error');
  });
}
