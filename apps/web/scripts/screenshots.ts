/**
 * Captures the PR screenshots into docs/screenshots/E0/ and docs/screenshots/E1/ (360x800, dark and light) after the
 * E-DM redesign. Needs `vite preview` on :4173 built with VITE_ENABLE_DEV_ROUTES=true. The API is mocked.
 * JPEG keeps the repo small (the fine grain makes PNG large).
 * Run: node --experimental-strip-types scripts/screenshots.ts
 */
import { mkdirSync, readdirSync, rmSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium, type Page } from '@playwright/test';
import {
  mockAccountApi,
  newAccount,
  PNG_1X1,
  publicUser,
  seedIntent,
  seedSession,
} from '../../../tests/e2e/accounts-helpers.ts';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '../../../docs/screenshots');
const base = process.env.BASE_URL ?? 'http://localhost:4173';
const QUALITY = 62;

const items = [
  {
    id: 'p1',
    name: 'Șelimbăr',
    secondary: 'Sibiu County',
    kind: 'area',
    point: { lat: 45.7595, lng: 24.2128 },
    areaName: 'Șelimbăr',
  },
  {
    id: 'p2',
    name: 'Piața Mare',
    secondary: 'Old town',
    kind: 'poi',
    point: { lat: 45.7972, lng: 24.1521 },
    areaName: 'Centru',
  },
];
const fold = (s: string) =>
  s
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase();

async function mockPlaces(page: Page) {
  await page.route('**/places?*', async (route) => {
    const q = fold(new URL(route.request().url()).searchParams.get('q') ?? '');
    await route.fulfill({ json: { items: items.filter((p) => fold(p.name).includes(q)) } });
  });
  await page.route('**/telemetry/error', (r) => r.fulfill({ status: 204 }));
}

for (const dir of ['E0', 'E1']) {
  mkdirSync(resolve(root, dir), { recursive: true });
  for (const f of readdirSync(resolve(root, dir))) rmSync(resolve(root, dir, f));
}

const browser = await chromium.launch();

async function context(theme: 'dark' | 'light', width = 360, height = 800) {
  const ctx = await browser.newContext({
    viewport: { width, height },
    deviceScaleFactor: 2,
    hasTouch: width < 600,
    colorScheme: theme,
  });
  await ctx.addInitScript((t) => window.localStorage.setItem('haide.theme', t), theme);
  return ctx;
}

const heading = (page: Page) => page.getByRole('heading', { level: 1 }).first().waitFor();

for (const theme of ['dark', 'light'] as const) {
  const shot = (page: Page, dir: string, name: string) =>
    page.screenshot({
      path: resolve(root, dir, `${name}-${theme}.jpg`),
      type: 'jpeg',
      quality: QUALITY,
    });

  // ---------------- E0 ----------------
  {
    const ctx = await context(theme);
    const page = await ctx.newPage();
    await mockPlaces(page);
    await page.goto(`${base}/find`);
    await heading(page);
    await page.waitForTimeout(1800); // route has drawn in, the light travels
    await shot(page, 'E0', '01-find');

    await page.getByRole('button', { name: 'Search rides' }).click();
    await shot(page, 'E0', '02-find-validation');

    await page.getByRole('button', { name: /^From/ }).click();
    await page.getByRole('searchbox').waitFor();
    await page.waitForTimeout(500);
    await shot(page, 'E0', '03-place-picker');

    await page.getByRole('searchbox').fill('Selimbar');
    await page.getByRole('listitem').first().waitFor();
    await page.waitForTimeout(300);
    await shot(page, 'E0', '04-place-picker-results');
    await page.keyboard.press('Escape');

    for (const [file, path] of [
      ['05-offer', '/offer'],
      ['06-my-rides', '/rides'],
      ['07-profile-display', '/profile'],
      ['08-not-found', '/nope'],
      ['09-route-map', '/dev/map'],
      ['10-motion-components', '/dev/motion'],
    ] as const) {
      await page.goto(`${base}${path}`);
      await heading(page);
      await page.waitForTimeout(1200);
      await shot(page, 'E0', file);
    }
    await ctx.close();
  }

  // ---------------- E1 ----------------
  {
    const ctx = await context(theme);
    const page = await ctx.newPage();
    await mockPlaces(page);
    await page.route('**/auth/v1/otp*', (r) => r.fulfill({ json: {} }));
    await page.route('**/users/u-2', (r) =>
      r.fulfill({
        json: publicUser({
          rating: { average: 4.8, count: 12 },
          ridesCompleted: 7,
          bio: 'Commute from Șelimbăr.',
        }),
      }),
    );
    await page.goto(`${base}/profile`);
    await heading(page);
    await page.waitForTimeout(600);
    await shot(page, 'E1', '1.7-profile-signed-out');

    await page.goto(`${base}/offer`);
    await page.getByRole('button', { name: 'Sign in or create account' }).click();
    await heading(page);
    await page.waitForTimeout(500);
    await shot(page, 'E1', '1.1-sign-in');
    await page.getByLabel('Email address').fill('ioana@example.com');
    await page.getByRole('button', { name: 'Email me a sign-in link' }).click();
    await page.getByRole('heading', { name: 'Check your email' }).waitFor();
    await page.waitForTimeout(400);
    await shot(page, 'E1', '1.2-check-email');

    await page.goto(`${base}/user/u-2`);
    await page.getByRole('heading', { name: 'Radu', exact: true }).waitFor();
    await page.waitForTimeout(400);
    await shot(page, 'E1', '1.6-public-profile');

    await page.goto(`${base}/policy/privacy`);
    await heading(page);
    await shot(page, 'E1', '6.2-privacy-policy');
    await ctx.close();
  }
  {
    const ctx = await context(theme);
    const page = await ctx.newPage();
    const acc = newAccount();
    await seedSession(page);
    await seedIntent(page, { kind: 'offer', returnTo: '/offer' });
    await mockAccountApi(page, acc);
    await page.goto(`${base}/auth/consent`);
    await heading(page);
    await page.getByRole('button', { name: 'Agree and continue' }).click();
    await page.waitForTimeout(400);
    await shot(page, 'E1', '1.3-agreement-errors');
    await page.getByRole('checkbox', { name: 'I am 18 or older' }).check();
    await page.getByRole('checkbox', { name: /I accept the/ }).check();
    await page.getByRole('button', { name: 'Agree and continue' }).click();
    await page.getByRole('heading', { name: 'Tell your neighbours who you are' }).waitFor();
    await page.getByRole('button', { name: 'Save and continue' }).click();
    await page.waitForTimeout(400);
    await shot(page, 'E1', '1.4-profile-errors');
    await page
      .locator('input[type=file]')
      .setInputFiles({ name: 'me.png', mimeType: 'image/png', buffer: PNG_1X1 });
    await page.getByLabel('First name').fill('Ștefan');
    await page.getByLabel('Phone number').fill('0721 234 567');
    await page.getByLabel(/About you/).fill('Șelimbăr to the old town.');
    await shot(page, 'E1', '1.4-profile-filled');
    await page.getByRole('button', { name: 'Save and continue' }).click();
    await page.getByRole('heading', { name: 'Your car' }).waitFor();
    await page.getByRole('button', { name: 'Save car' }).click();
    await page.waitForTimeout(400);
    await shot(page, 'E1', '1.5-car-errors');
    await page.getByLabel('Make').fill('Dacia');
    await page.getByLabel('Model').fill('Logan');
    await page.getByLabel('Colour').fill('Grey');
    await page.getByLabel('Number plate').fill('sb 12 abc');
    await page.getByLabel('Fuel type').selectOption('petrol');
    await page.getByLabel('Seats for passengers').selectOption('3');
    await page.getByRole('button', { name: 'Save car' }).click();
    await page.waitForURL(/\/offer$/);
    await page.waitForTimeout(500);
    await shot(page, 'E1', '1.5-offer-ready');
    await page.goto(`${base}/profile`);
    await page
      .getByRole('heading', { name: 'Ioana' })
      .or(page.getByText('Ștefan', { exact: true }))
      .first()
      .waitFor();
    await page.waitForTimeout(500);
    await shot(page, 'E1', '1.7-own-profile');
    await ctx.close();
  }
}

// Desktop (tablet and up): one per theme.
for (const theme of ['dark', 'light'] as const) {
  const ctx = await context(theme, 1280, 800);
  const page = await ctx.newPage();
  await mockPlaces(page);
  await page.goto(`${base}/find`);
  await heading(page);
  await page.waitForTimeout(1800);
  await page.screenshot({
    path: resolve(root, 'E0', `11-find-desktop-${theme}.jpg`),
    type: 'jpeg',
    quality: QUALITY,
  });
  await ctx.close();
}

await browser.close();
console.log(`screenshots: ${root}`);
