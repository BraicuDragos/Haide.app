import { expect, test, type Page } from '@playwright/test';
import {
  expectNoAxeViolations,
  mockAccountApi,
  newAccount,
  publicUser,
  seedIntent,
  seedSession,
} from './accounts-helpers';

// E-DM: dark-first theme, light theme, motion preferences and the reusable motion components.

const SCREENS = [
  '/find',
  '/offer',
  '/rides',
  '/profile',
  '/auth',
  '/policy/terms',
  '/policy/privacy',
  '/dev/map',
  '/dev/motion',
  '/no-such-page',
];

const html = (page: Page, attr: 'data-theme' | 'data-motion') =>
  page.evaluate((a) => document.documentElement.getAttribute(a), attr);

/** Count of running infinite animations (the travelling light, the breathing aura, the empty-state breath). */
const loops = (page: Page) =>
  page.evaluate(
    () =>
      document
        .getAnimations()
        .filter(
          (a) => a.playState === 'running' && a.effect?.getComputedTiming().iterations === Infinity,
        ).length,
  );

test.beforeEach(async ({ page }) => {
  await page.route('**/telemetry/error', (route) => route.fulfill({ status: 204 }));
});

for (const theme of ['dark', 'light'] as const) {
  test.describe(`${theme} theme at 360x800`, () => {
    test.beforeEach(async ({ page }) => {
      await page.addInitScript((t) => window.localStorage.setItem('haide.theme', t), theme);
    });

    for (const path of SCREENS) {
      test(`${path}: theme applied, axe clean, no horizontal scroll`, async ({ page }) => {
        await page.goto(path);
        expect(await html(page, 'data-theme')).toBe(theme);
        await page.waitForTimeout(300);
        await expectNoAxeViolations(page);
        const overflow = await page.evaluate(
          () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
        );
        expect(overflow).toBe(false);
      });
    }

    test('account screens (agreement, profile, car, hub, public profile) are axe clean', async ({
      page,
    }) => {
      const acc = newAccount({
        firstName: 'Ioana',
        phoneE164: '+40721234567',
        profileComplete: true,
        hasVehicle: true,
      });
      acc.vehicle = {
        make: 'Dacia',
        model: 'Logan',
        colour: 'Grey',
        plate: 'SB12ABC',
        fuelType: 'petrol',
        seats: 3,
      };
      await seedSession(page);
      await seedIntent(page, { kind: 'offer', returnTo: '/offer' });
      await mockAccountApi(page, acc);
      await page.route('**/users/u-2', (r) => r.fulfill({ json: publicUser() }));
      for (const path of [
        '/auth/consent',
        '/setup/profile',
        '/setup/vehicle',
        '/profile/edit',
        '/profile/car',
        '/user/u-2',
        '/profile',
      ]) {
        await page.goto(path);
        await page.getByRole('heading', { level: 1 }).first().waitFor();
        await page.waitForTimeout(300);
        expect(await html(page, 'data-theme')).toBe(theme);
        await expectNoAxeViolations(page);
      }
    });

    test('text tokens: body is light on dark, dark on light', async ({ page }) => {
      await page.goto('/find');
      const [bg, fg] = await page.evaluate(() => {
        const s = getComputedStyle(document.body);
        return [s.backgroundColor, s.color];
      });
      const lum = (rgb: string) => {
        const m = rgb.match(/\d+/g)!.map(Number);
        return (m[0]! + m[1]! + m[2]!) / 3;
      };
      if (theme === 'dark') expect(lum(bg)).toBeLessThan(lum(fg));
      else expect(lum(bg)).toBeGreaterThan(lum(fg));
    });
  });
}

test.describe('theme', () => {
  // ADR 0016: dark is the default. With no stored choice the OS preference is ignored; "Auto" in Settings is an
  // explicit choice that follows it.
  test('dark by default, even on a light OS; Auto (explicit) follows the OS', async ({
    browser,
  }) => {
    const light = await browser.newContext({ colorScheme: 'light' });
    const p1 = await light.newPage();
    await p1.goto('/find');
    expect(await html(p1, 'data-theme')).toBe('dark');
    await p1.goto('/profile');
    await p1.getByRole('radio', { name: 'Auto' }).check({ force: true });
    expect(await html(p1, 'data-theme')).toBe('light');
    await p1.reload();
    expect(await html(p1, 'data-theme')).toBe('light');
    await light.close();

    const dark = await browser.newContext({ colorScheme: 'dark' });
    const p2 = await dark.newPage();
    await p2.goto('/find');
    expect(await html(p2, 'data-theme')).toBe('dark');
    await dark.close();
  });

  test('the Display setting is remembered across reloads', async ({ page }) => {
    await page.emulateMedia({ colorScheme: 'light' });
    await page.goto('/profile');
    expect(await html(page, 'data-theme')).toBe('dark'); // no choice yet: dark even on a light OS
    await expect(page.getByRole('radio', { name: 'Dark' })).toBeChecked();
    await page.getByRole('radio', { name: 'Light' }).check({ force: true });
    expect(await html(page, 'data-theme')).toBe('light');
    await page.reload();
    expect(await html(page, 'data-theme')).toBe('light');
    await expect(page.getByRole('radio', { name: 'Light' })).toBeChecked();
    expect(await page.evaluate(() => window.localStorage.getItem('haide.theme'))).toBe('light');
    // Auto: an explicit choice that follows the OS (light here).
    await page.getByRole('radio', { name: 'Auto' }).check({ force: true });
    expect(await html(page, 'data-theme')).toBe('light');
    expect(await page.evaluate(() => window.localStorage.getItem('haide.theme'))).toBe('system');
    await page.emulateMedia({ colorScheme: 'dark' });
    expect(await html(page, 'data-theme')).toBe('dark');
  });

  test('works when storage is blocked', async ({ page }) => {
    await page.addInitScript(() => {
      Object.defineProperty(window, 'localStorage', {
        get() {
          throw new Error('blocked');
        },
      });
    });
    await page.goto('/profile');
    await expect(page.getByRole('heading', { level: 1, name: 'Profile' })).toBeVisible();
    await page.getByRole('radio', { name: 'Light' }).check({ force: true });
    expect(await html(page, 'data-theme')).toBe('light');
  });
});

test.describe('reduced motion', () => {
  test('OS setting: no loops, still light, route fully drawn', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.goto('/find');
    expect(await html(page, 'data-motion')).toBe('reduced');
    await page.waitForTimeout(600);
    expect(await loops(page)).toBe(0);
    await expect(page.locator('.route-fx .pl.still')).toHaveCSS('opacity', '1');
    await expect(page.locator('.route-fx .pl.amb')).toHaveCSS('opacity', '0');
    // CSS layer: transitions are effectively off.
    const dur = await page
      .locator('.btn-primary')
      .first()
      .evaluate((el) => getComputedStyle(el).transitionDuration);
    expect(dur).toMatch(/^0\.00?1?s|^1e-05s|^0s/);
  });

  test('without it the route light and aura loop', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'no-preference' });
    await page.goto('/find');
    expect(await html(page, 'data-motion')).toBe('full');
    await expect.poll(() => loops(page)).toBeGreaterThan(0);
  });

  test('in-app switch stops motion, persists, and beats the OS in both directions', async ({
    page,
  }) => {
    await page.emulateMedia({ reducedMotion: 'no-preference' });
    await page.goto('/profile');
    const sw = page.getByRole('switch', { name: /Reduce motion/ });
    await expect(sw).not.toBeChecked();
    await sw.check({ force: true });
    expect(await html(page, 'data-motion')).toBe('reduced');
    expect(await page.evaluate(() => window.localStorage.getItem('haide.motion'))).toBe('reduced');
    await page.goto('/find');
    expect(await html(page, 'data-motion')).toBe('reduced');
    expect(await loops(page)).toBe(0);
    await page.reload();
    expect(await html(page, 'data-motion')).toBe('reduced');

    // OS asks for reduced motion, the person switches it back on here: the switch wins.
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.goto('/profile');
    await expect(sw).toBeChecked();
    await sw.uncheck({ force: true });
    expect(await html(page, 'data-motion')).toBe('full');
    await page.goto('/find');
    expect(await html(page, 'data-motion')).toBe('full');
    await expect.poll(() => loops(page)).toBeGreaterThan(0);
  });
});

test.describe('motion components (dev harness)', () => {
  test('price reveal keeps an accessible amount and rolls on a drop', async ({ page }) => {
    await page.goto('/dev/motion');
    const price = page.getByTestId('price');
    await expect(price.getByText('3.10 RON', { exact: true })).toBeAttached();
    await expect(price.locator('.roll')).toHaveAttribute('aria-hidden', 'true');
    await page.getByRole('button', { name: 'Drop the price' }).click();
    await expect(price.getByText('1.90 RON', { exact: true })).toBeAttached();
  });

  test('seat picker is a radio group and updates the count', async ({ page }) => {
    await page.goto('/dev/motion');
    const group = page.getByRole('group', { name: 'Free seats' });
    await expect(group.getByRole('radio', { name: '2 seats' })).toBeChecked();
    await group.getByRole('radio', { name: '4 seats' }).check({ force: true });
    await expect(page.locator('p.type-numeral-sm')).toHaveText('4 seats');
    await expect(group.locator('.face.on')).toHaveCount(4);
    await group.getByRole('radio', { name: '1 seat' }).check({ force: true });
    await expect(group.locator('.face.on')).toHaveCount(1);
  });

  test('launch: wordmark is decorative, plain confirmation is announced, no double submit', async ({
    page,
  }) => {
    await page.emulateMedia({ reducedMotion: 'no-preference' });
    await page.goto('/dev/motion');
    const btn = page.getByRole('button', { name: 'Send request' });
    await btn.click();
    await expect(page.getByRole('button', { name: 'Seat requested' })).toHaveAttribute(
      'aria-disabled',
      'true',
    );
    // The wordmark exists, is aria-hidden, and animates only now.
    const mark = page.locator('.cta .l3');
    await expect(mark).toHaveText('Haide!');
    await expect(mark).toHaveAttribute('aria-hidden', 'true');
    await expect(page.getByRole('status').filter({ hasText: 'Seat requested' })).toBeAttached();
    await expect(page.getByText('Done: sent')).toBeVisible({ timeout: 5000 });
    // "Haide!" is not in the live region or any accessible name.
    await expect(page.getByRole('status').filter({ hasText: 'Haide!' })).toHaveCount(0);
  });

  test('launch offline-queued: plain "Request saved", wordmark never plays', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'no-preference' });
    await page.goto('/dev/motion');
    await page.getByRole('radio', { name: 'saved' }).check({ force: true });
    await page.getByRole('button', { name: 'Send request' }).click();
    await expect(page.getByRole('button', { name: 'Request saved' })).toBeVisible();
    expect(await page.locator('.cta .l3').evaluate((el) => el.getAnimations().length)).toBe(0);
    await expect(page.getByText('Done: saved')).toBeVisible({ timeout: 5000 });
  });

  test('launch failure restores the button and shows the error without the wordmark', async ({
    page,
  }) => {
    await page.goto('/dev/motion');
    await page.getByRole('radio', { name: 'fail' }).check({ force: true });
    await page.getByRole('button', { name: 'Send request' }).click();
    await expect(page.getByRole('alert')).toContainText('That didn’t work');
    await expect(page.getByRole('button', { name: 'Send request' })).not.toHaveAttribute(
      'aria-disabled',
      'true',
    );
    expect(await page.locator('.cta .l3').evaluate((el) => el.getAnimations().length)).toBe(0);
  });

  test('launch with reduced motion: label changes, nothing travels', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.goto('/dev/motion');
    await page.getByRole('button', { name: 'Send request' }).click();
    await expect(page.getByRole('button', { name: 'Seat requested' })).toBeVisible();
    expect(
      await page.locator('.cta').evaluate((el) => el.getAnimations({ subtree: true }).length),
    ).toBe(0);
    await expect(page.getByText('Done: sent')).toBeVisible({ timeout: 3000 });
  });

  test('branded loading and empty states replace spinners', async ({ page }) => {
    await page.goto('/dev/motion');
    await expect(
      page.getByRole('status').filter({ hasText: 'Looking for rides on your route' }),
    ).toBeVisible();
    await expect(page.locator('.spin, .skeleton')).toHaveCount(0);
  });
});

test('"Haide!" is the only exclamation mark visible in the Find screen copy', async ({ page }) => {
  await page.goto('/find');
  expect(await page.locator('body').innerText()).not.toContain('!');
});
