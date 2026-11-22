import { expect, test } from '@playwright/test';
import { expectNoAxeViolations } from './accounts-helpers';
import { setupE6 } from './e6-helpers';

// E6 (privacy and compliance), web side. The API is mocked: retention, purge and the deletion cascade are covered by
// the backend suites. These specs check what the person sees and sends at 360x800 in dark and light.

for (const theme of ['dark', 'light'] as const) {
  test.describe(`E6, ${theme}`, () => {
    test('Settings > Delete account: Keep sends nothing, Delete signs out with a toast', async ({
      page,
    }) => {
      const { calls } = await setupE6(page, { theme });
      await page.goto('/profile');
      const group = page.getByRole('region', { name: 'Privacy and data' });
      await expect(group.getByRole('link', { name: 'Privacy policy' })).toBeVisible();
      await expect(group.getByRole('link', { name: 'Terms of use' })).toBeVisible();
      await group.getByRole('link', { name: 'Delete account' }).click();

      await expect(page).toHaveURL(/\/delete$/);
      await expect(
        page.getByRole('heading', { level: 1, name: 'Delete your account?' }),
      ).toBeFocused();
      await expect(page.getByText('This can’t be undone.')).toBeVisible();
      await expect(page.getByText(/upcoming rides and bookings are cancelled/)).toBeVisible();
      await expect(page.getByText(/erased within 30 days/)).toBeVisible();
      await expect(page.getByText(/shown as “Deleted user”/)).toBeVisible();
      await expectNoAxeViolations(page);

      // touch targets
      for (const name of ['Keep my account', 'Delete account']) {
        const box = await page.getByRole('button', { name }).boundingBox();
        expect(box!.height).toBeGreaterThanOrEqual(44);
      }

      await page.getByRole('button', { name: 'Keep my account' }).click();
      await expect(page).toHaveURL(/\/profile$/);
      expect(calls.deletes).toEqual([]);

      await group.getByRole('link', { name: 'Delete account' }).click();
      await page.getByRole('button', { name: 'Delete account' }).click();
      await expect(page).toHaveURL(/\/find$/);
      await expect(
        page.getByText('Account deleted. We erase your data within 30 days.'),
      ).toBeVisible();
      expect(calls.deletes).toEqual([{ confirm: 'DELETE' }]);
      // signed out: the profile hub shows the visitor card and no account rows
      await page.goto('/profile');
      await expect(page.getByRole('link', { name: 'Delete account' })).toHaveCount(0);
    });

    test('Delete account shows an inline error and stays signed in when the call fails', async ({
      page,
    }) => {
      await setupE6(page, { theme });
      await page.route('**/api/v1/me', (r) =>
        r.request().method() === 'DELETE'
          ? r.fulfill({
              status: 503,
              json: { error: { code: 'INTERNAL', message: 'x', requestId: 'r' } },
            })
          : r.fallback(),
      );
      await page.goto('/delete');
      await page.getByRole('button', { name: 'Delete account' }).click();
      await expect(
        page.getByRole('alert').filter({ hasText: 'We couldn’t delete your account. Try again.' }),
      ).toBeVisible();
      await expect(page).toHaveURL(/\/delete$/);
      await expect(page.getByRole('button', { name: 'Delete account' })).toBeEnabled();
      await expectNoAxeViolations(page);
    });

    test('Request my data confirms in a toast and in the row', async ({ page }) => {
      const { calls } = await setupE6(page, { theme });
      await page.goto('/profile');
      await page.getByRole('button', { name: /Request a copy of my data/ }).click();
      await expect(
        page.getByText('Request sent. We’ll email your data within 30 days.'),
      ).toBeVisible();
      await expect(
        page.getByRole('status').filter({ hasText: /Request sent on .* We’ll reply by / }),
      ).toBeVisible();
      expect(calls.dataRequests).toBe(1);
    });

    test('Request my data: an older open request shows its own dates', async ({ page }) => {
      await setupE6(page, {
        theme,
        dataRequest: { requestedAt: '2026-11-10T09:00:00Z', dueBy: '2026-12-10T09:00:00Z' },
      });
      await page.goto('/profile');
      await page.getByRole('button', { name: /Request a copy of my data/ }).click();
      await expect(
        page
          .getByText('Request sent on 10 November 2026. We’ll reply by 10 December 2026.')
          .first(),
      ).toBeVisible();
    });

    test('Policy pages open signed out, with contents anchors and the v1.2 text', async ({
      page,
    }) => {
      await setupE6(page, { theme, signedIn: false });
      await page.goto('/policy/terms');
      await expect(page.getByRole('heading', { level: 1, name: 'Terms of use' })).toBeVisible();
      await expect(page.getByText('Version 1.2, in force from 22 November 2026')).toBeVisible();
      await expect(page.getByText(/The driver makes no profit from a ride/)).toBeVisible();
      await expect(
        page.getByText(/Drivers must not ask for extra payments, surcharges or tips/),
      ).toBeVisible();
      await expect(page.getByText(/up to 4 rides a day/)).toBeVisible();
      await expect(page.getByText(/You must be 18 or older/)).toBeVisible();

      const toc = page.getByRole('navigation', { name: 'Contents' });
      await toc.getByRole('link', { name: 'Ride limits' }).click();
      await expect(page).toHaveURL(/#terms-ride-limits$/);
      await expect(page.locator('#terms-ride-limits')).toBeInViewport();
      await expectNoAxeViolations(page);

      await page.goto('/policy/privacy');
      await expect(page.getByRole('heading', { level: 1, name: 'Privacy policy' })).toBeVisible();
      await expect(
        page.getByText(/Data controller: Dragoș Braicu, a private individual/),
      ).toBeVisible();
      await expect(page.getByText(/ANSPDCP/).first()).toBeVisible();
      await expect(page.getByRole('heading', { name: /Processors and transfers/ })).toBeVisible();
      await page
        .getByRole('navigation', { name: 'Contents' })
        .getByRole('link', { name: 'Complaints' })
        .click();
      await expect(page.locator('#privacy-complaints')).toBeInViewport();
      await expectNoAxeViolations(page);
    });

    test('Policy pages are reachable from Settings', async ({ page }) => {
      await setupE6(page, { theme });
      await page.goto('/profile');
      await page.getByRole('link', { name: 'Terms of use' }).click();
      await expect(page.getByRole('heading', { level: 1, name: 'Terms of use' })).toBeVisible();
      await page.getByRole('button', { name: 'Back' }).click();
      await page.getByRole('link', { name: 'Privacy policy' }).click();
      await expect(page.getByRole('heading', { level: 1, name: 'Privacy policy' })).toBeVisible();
    });

    test('updated terms: a protected route redirects to the consent update, accept returns', async ({
      page,
    }) => {
      const { calls } = await setupE6(page, { theme, reaccept: true });
      await page.route('**/api/v1/rides*', (r) => r.fulfill({ json: { items: [] } }));
      await page.route('**/api/v1/bookings*', (r) => r.fulfill({ json: { items: [] } }));
      await page.goto('/rides');
      await expect(page).toHaveURL(/\/auth\/consent\?returnTo=%2Frides$/);
      await expect(
        page.getByRole('heading', { level: 1, name: 'We’ve updated our terms' }),
      ).toBeVisible();
      await expect(page.getByRole('heading', { name: 'What changed' })).toBeVisible();
      await expect(page.getByText(/Who runs Haide is now stated/)).toBeVisible();
      await expect(page.getByRole('link', { name: 'Read the full Terms of use' })).toBeVisible();
      // no age box in update mode
      await expect(page.getByLabel('I am 18 or older')).toHaveCount(0);
      await expectNoAxeViolations(page);

      // unchecked: an error, nothing sent
      await page.getByRole('button', { name: 'Agree and continue' }).click();
      await expect(
        page.getByRole('alert').filter({ hasText: 'Accept the updated terms to continue.' }),
      ).toBeVisible();
      expect(calls.consents).toEqual([]);

      await page.getByLabel('I accept the updated Terms of use and Privacy policy').check();
      await page.getByRole('button', { name: 'Agree and continue' }).click();
      await expect(page).toHaveURL(/\/rides$/);
      expect(calls.consents).toEqual([{ termsVersion: '1.2', privacyVersion: '1.2' }]);
    });

    test('updated terms: policy pages stay readable, and delete is offered', async ({ page }) => {
      await setupE6(page, { theme, reaccept: true });
      await page.goto('/policy/terms');
      await expect(page).toHaveURL(/\/policy\/terms$/);
      await expect(page.getByRole('heading', { level: 1, name: 'Terms of use' })).toBeVisible();
      await page.goto('/auth/consent');
      await page.getByRole('link', { name: 'I’d rather delete my account' }).click();
      await expect(page).toHaveURL(/\/delete$/);
      await expect(
        page.getByRole('heading', { level: 1, name: 'Delete your account?' }),
      ).toBeVisible();
    });

    test('a suspended account can still reach Delete account', async ({ page }) => {
      await setupE6(page, { theme });
      await page.route('**/api/v1/me', (r) =>
        r.request().method() === 'GET'
          ? r.fulfill({
              status: 403,
              json: { error: { code: 'ACCOUNT_SUSPENDED', message: 'x', requestId: 'r' } },
            })
          : r.fallback(),
      );
      await page.goto('/rides');
      await page.getByRole('link', { name: 'Delete account' }).click();
      await expect(page).toHaveURL(/\/delete$/);
      await expect(
        page.getByRole('heading', { level: 1, name: 'Delete your account?' }),
      ).toBeVisible();
    });

    test('an account deleted elsewhere is signed out with a message', async ({ page }) => {
      await setupE6(page, { theme });
      await page.route('**/api/v1/me', (r) =>
        r.request().method() === 'GET'
          ? r.fulfill({
              status: 403,
              json: { error: { code: 'ACCOUNT_DELETED', message: 'x', requestId: 'r' } },
            })
          : r.fallback(),
      );
      await page.goto('/profile');
      await expect(page.getByText('This account was deleted.')).toBeVisible();
    });
  });
}

test.describe('E6 reduced motion', () => {
  test('the delete flow and the update screen do not animate', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await setupE6(page, { reaccept: true });
    await page.goto('/auth/consent');
    await expect(
      page.getByRole('heading', { level: 1, name: 'We’ve updated our terms' }),
    ).toBeVisible();
    await page.getByLabel('I accept the updated Terms of use and Privacy policy').check();
    await page.getByRole('button', { name: 'Agree and continue' }).click();
    await page.goto('/delete');
    const btn = page.getByRole('button', { name: 'Delete account' });
    await btn.click();
    await expect(
      page.getByText('Account deleted. We erase your data within 30 days.'),
    ).toBeVisible();
    const toast = page.locator('.toast');
    const anim = await toast.evaluate((el) => {
      const cs = getComputedStyle(el);
      return { name: cs.animationName, dur: parseFloat(cs.animationDuration) };
    });
    expect(anim.name === 'none' || anim.dur <= 0.001).toBe(true);
    // smooth scrolling is never used on the policy pages
    await page.goto('/policy/privacy');
    const behavior = await page.evaluate(
      () => getComputedStyle(document.documentElement).scrollBehavior,
    );
    expect(behavior).not.toBe('smooth');
  });
});
