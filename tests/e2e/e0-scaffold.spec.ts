import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page, type Route } from '@playwright/test';

const REAL_API = process.env.E2E_REAL_API === '1';

const GAZETTEER = [
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
  {
    id: 'p3',
    name: 'Cisnădie',
    secondary: 'Sibiu County',
    kind: 'area',
    point: { lat: 45.7105, lng: 24.153 },
    areaName: 'Cisnădie',
  },
];
const fold = (s: string) =>
  s
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase();

/** Mocks GET /places (diacritics-insensitive, like the gazetteer) and POST /places/reverse when no real API is wired. */
async function mockApi(page: Page) {
  if (REAL_API) return;
  await page.route('**/places?*', async (route: Route) => {
    const q = fold(new URL(route.request().url()).searchParams.get('q') ?? '');
    const items = GAZETTEER.filter((p) => fold(p.name).includes(q));
    await route.fulfill({ json: { items } });
  });
  await page.route('**/places/reverse', (route: Route) =>
    route.fulfill({ json: { place: GAZETTEER[1] } }),
  );
  await page.route('**/telemetry/error', (route: Route) => route.fulfill({ status: 204 }));
}

async function expectNoAxeViolations(page: Page) {
  const results = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
    .analyze();
  const summary = JSON.stringify(
    results.violations.map((v) => [v.id, v.nodes.map((n) => n.target)]),
    null,
    1,
  );
  expect(results.violations, summary).toEqual([]);
}

test.beforeEach(async ({ page }) => {
  await mockApi(page);
});

test('opens on Find, axe clean, no horizontal scroll', async ({ page }) => {
  await page.goto('/');
  await expect(page).toHaveURL(/\/find$/);
  await expect(page.getByRole('heading', { level: 1, name: 'Find a ride' })).toBeVisible();
  await expect(page).toHaveTitle('Find a ride · Haide');
  await expectNoAxeViolations(page);
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
  );
  expect(overflow).toBe(false);
});

test('tab bar navigates, focuses the h1 and sets the title', async ({ page }) => {
  await page.goto('/find');
  const nav = page.getByRole('navigation', { name: 'Main' });
  for (const [tab, h1] of [
    ['Offer', 'Offer a ride'],
    ['My rides', 'My rides'],
    ['Profile', 'Profile'],
    ['Find', 'Find a ride'],
  ] as const) {
    await nav.getByRole('link', { name: tab }).click();
    const heading = page.getByRole('heading', { level: 1, name: h1 });
    await expect(heading).toBeFocused();
    await expect(page).toHaveTitle(`${h1} · Haide`);
    await expect(nav.getByRole('link', { name: tab })).toHaveAttribute('aria-current', 'page');
    await expectNoAxeViolations(page);
  }
});

test('skip link is the first tab stop and moves focus to main', async ({ page }) => {
  await page.goto('/find');
  await page.keyboard.press('Tab');
  const skip = page.getByRole('link', { name: 'Skip to main content' });
  await expect(skip).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page.locator('main')).toBeFocused();
});

test('unknown route shows the 404 screen', async ({ page }) => {
  await page.goto('/nope');
  await expect(
    page.getByRole('heading', { level: 1, name: 'This page doesn’t exist' }),
  ).toBeVisible();
  await expect(page.getByRole('navigation', { name: 'Main' })).toHaveCount(0);
  await expectNoAxeViolations(page);
});

test('place picker finds Șelimbăr from "Selimbar" (diacritics demo)', async ({ page }) => {
  await page.goto('/find');
  await page.getByRole('button', { name: /^From/ }).click();
  const dialog = page.getByRole('dialog', { name: 'Where do you start?' });
  await expect(dialog).toBeVisible();
  const search = dialog.getByRole('searchbox', { name: 'Search a street or place in Sibiu' });
  await expect(search).toBeFocused();
  await expectNoAxeViolations(page);

  await search.fill('Selimbar');
  const first = dialog.getByRole('listitem').first().getByRole('button');
  await expect(first).toContainText('Șelimbăr');
  await expect(dialog.getByRole('heading', { name: /places? found/ })).toBeVisible();
  await expectNoAxeViolations(page);

  await first.click();
  await expect(dialog).toBeHidden();
  await expect(page.getByRole('button', { name: 'From Șelimbăr' })).toBeFocused();
});

test('place picker: empty result, Esc closes and returns focus', async ({ page }) => {
  await page.goto('/find');
  const opener = page.getByRole('button', { name: /^To/ });
  await opener.click();
  const dialog = page.getByRole('dialog');
  await dialog.getByRole('searchbox').fill('zzzz');
  await expect(dialog.getByText('No match for “zzzz”').first()).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
  await expect(opener).toBeFocused();
});

test('place picker: API error shows a retry', async ({ page }) => {
  test.skip(REAL_API, 'error state needs the mocked API');
  await page.route('**/places?*', (route) =>
    route.fulfill({
      status: 503,
      json: { error: { code: 'UPSTREAM_ERROR', message: 'x', requestId: 'r' } },
    }),
  );
  await page.goto('/find');
  await page.getByRole('button', { name: /^From/ }).click();
  await page.getByRole('searchbox').fill('piata');
  await expect(page.getByRole('alert')).toContainText('A service we rely on isn’t answering');
  await expect(page.getByRole('button', { name: 'Try again' })).toBeVisible();
});

test.describe('use my location', () => {
  test.use({
    permissions: ['geolocation'],
    geolocation: { latitude: 45.7972, longitude: 24.1521 },
  });
  test('reverse-geocodes once and fills the field', async ({ page }) => {
    test.skip(REAL_API, 'reverse result is mocked');
    await page.goto('/find');
    await page.getByRole('button', { name: /^From/ }).click();
    await page.getByRole('button', { name: 'Use my location' }).click();
    await expect(page.getByRole('button', { name: 'From Piața Mare' })).toBeVisible();
  });
});

test('form validation: missing places and time', async ({ page }) => {
  await page.goto('/find');
  await page.getByRole('button', { name: 'Search rides' }).click();
  await expect(page.getByRole('alert').first()).toContainText('Choose where you start');
  await expect(page.getByRole('button', { name: /^From/ })).toBeFocused();
  await expect(page.getByRole('button', { name: /^From/ })).toHaveAttribute('aria-invalid', 'true');
  await expectNoAxeViolations(page);
});

test('PWA: manifest, service worker, installable shape', async ({ page, request }) => {
  await page.goto('/find');
  const href = await page.locator('link[rel="manifest"]').getAttribute('href');
  expect(href).toBeTruthy();
  const manifest = await (await request.get(href as string)).json();
  expect(manifest).toMatchObject({
    name: 'Haide',
    start_url: '/find',
    display: 'standalone',
    theme_color: '#12112A',
  });
  const sizes = manifest.icons.map((i: { sizes: string }) => i.sizes);
  expect(sizes).toEqual(expect.arrayContaining(['192x192', '512x512']));
  const ready = await page.evaluate(async () => {
    const reg = await navigator.serviceWorker.ready;
    return Boolean(reg.active);
  });
  expect(ready).toBe(true);
});

test('security headers (CSP) are served and the app runs under them', async ({ page }) => {
  const errors: string[] = [];
  page.on('console', (m) => {
    if (m.type() === 'error' && /Content Security Policy/i.test(m.text())) errors.push(m.text());
  });
  const res = await page.goto('/find');
  expect(res?.headers()['content-security-policy']).toContain("default-src 'self'");
  await page.getByRole('button', { name: /^From/ }).click();
  await page.getByRole('searchbox').fill('cis');
  await expect(page.getByRole('listitem').first()).toBeVisible();
  expect(errors).toEqual([]);
});

test('RouteMap degrades gracefully and keeps its text alternative', async ({ page }) => {
  await page.goto('/dev/map');
  await expect(page.getByRole('heading', { level: 1, name: 'Map demo' })).toBeVisible();
  await expect(page.getByRole('img', { name: /Map of the route/ })).toHaveCount(2);
  await expect(page.getByText('Pickup: Cisnădie. Drop-off: Piața Mare.').first()).toBeVisible();
  // The tile file may be absent before scripts/geo/build-tiles.sh runs: the canvas or the fallback message is fine.
  await expect(
    page.locator('canvas.maplibregl-canvas, :text("The map isn’t available right now")').first(),
  ).toBeVisible({ timeout: 15_000 });
  await expectNoAxeViolations(page);
});

test('Profile shows the OpenStreetMap (ODbL) attribution', async ({ page }) => {
  await page.goto('/profile');
  await expect(
    page.getByRole('heading', { level: 2, name: 'About and data sources' }),
  ).toBeVisible();
  await expect(page.getByText('Open Database Licence')).toBeVisible();
  await expect(
    page.getByRole('link', { name: 'OpenStreetMap copyright and licence' }),
  ).toHaveAttribute('href', 'https://www.openstreetmap.org/copyright');
  await expectNoAxeViolations(page);
});
