import { test } from '@playwright/test';
import { setupE6 } from './e6-helpers';

/**
 * Screenshots of the E6 screens for the PR (docs/screenshots/E6, dark and light). Not a test: runs only with
 * E2E_SCREENSHOTS=1 (`E2E_SCREENSHOTS=1 pnpm exec playwright test tests/e2e/e6-screenshots.spec.ts`).
 */
test.skip(!process.env.E2E_SCREENSHOTS, 'set E2E_SCREENSHOTS=1 to regenerate the E6 screenshots');

const OUT = 'docs/screenshots/E6';

for (const theme of ['dark', 'light'] as const) {
  test(`E6 screens, ${theme}`, async ({ page }) => {
    test.setTimeout(120_000);
    const shot = (name: string, fullPage = true) =>
      page.screenshot({ path: `${OUT}/${name}-${theme}.jpg`, type: 'jpeg', quality: 82, fullPage });
    const settle = (ms = 600) => page.waitForTimeout(ms);

    // Signed in: Settings group, data request confirmed, delete screen with its error state
    await setupE6(page, { theme });
    await page.route('**/api/v1/rides*', (r) => r.fulfill({ json: { items: [] } }));
    await page.goto('/profile');
    await page.getByRole('region', { name: 'Privacy and data' }).waitFor();
    await page.getByRole('button', { name: /Request a copy of my data/ }).click();
    await page
      .getByRole('status')
      .filter({ hasText: /Request sent on/ })
      .waitFor();
    await settle();
    await page.getByRole('region', { name: 'Privacy and data' }).scrollIntoViewIfNeeded();
    await shot('6.1-settings-privacy', false);

    await page.goto('/delete');
    await page.getByRole('heading', { level: 1, name: 'Delete your account?' }).waitFor();
    await settle();
    await shot('6.4-delete-account');

    await page.route('**/api/v1/me', (r) =>
      r.request().method() === 'DELETE'
        ? r.fulfill({
            status: 503,
            json: { error: { code: 'INTERNAL', message: 'x', requestId: 'r' } },
          })
        : r.fallback(),
    );
    await page.getByRole('button', { name: 'Delete account' }).click();
    await page
      .getByRole('alert')
      .filter({ hasText: /couldn’t delete/ })
      .waitFor();
    await settle(300);
    await shot('6.4-delete-account-error');

    // Policy pages (signed in here; they look the same signed out)
    await page.goto('/policy/terms');
    await page.getByRole('heading', { level: 1, name: 'Terms of use' }).waitFor();
    await settle();
    await shot('6.2-policy-terms', false);
    await page
      .getByRole('navigation', { name: 'Contents' })
      .getByRole('link', { name: 'Cost sharing' })
      .click();
    await settle(300);
    await shot('6.2-policy-terms-cost-sharing', false);
    await page.goto('/policy/privacy');
    await page.getByRole('heading', { level: 1, name: 'Privacy policy' }).waitFor();
    await settle();
    await shot('6.2-policy-privacy', false);
  });

  test(`E6 updated terms, ${theme}`, async ({ page }) => {
    await setupE6(page, { theme, reaccept: true });
    await page.goto('/rides');
    await page.getByRole('heading', { level: 1, name: 'We’ve updated our terms' }).waitFor();
    await page.getByText(/Who runs Haide is now stated/).waitFor();
    await page.waitForTimeout(600);
    await page.screenshot({
      path: `${OUT}/1.3b-consent-update-${theme}.jpg`,
      type: 'jpeg',
      quality: 82,
      fullPage: true,
    });
  });
}
