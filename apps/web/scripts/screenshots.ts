/**
 * Captures the E0 screenshots for the PR into docs/screenshots/E0/ (360x800 mobile plus one desktop).
 * Needs `vite preview` on :4173 (built with VITE_ENABLE_DEV_ROUTES=true). /places is mocked.
 * Run: node --experimental-strip-types scripts/screenshots.ts
 */
import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';

const here = dirname(fileURLToPath(import.meta.url));
const out = resolve(here, '../../../docs/screenshots/E0');
mkdirSync(out, { recursive: true });
const base = process.env.BASE_URL ?? 'http://localhost:4173';

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

const browser = await chromium.launch();
const ctx = await browser.newContext({
  viewport: { width: 360, height: 800 },
  deviceScaleFactor: 2,
  hasTouch: true,
});
const page = await ctx.newPage();
await page.route('**/places?*', async (route) => {
  const q = (new URL(route.request().url()).searchParams.get('q') ?? '')
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase();
  const found = items.filter((p) =>
    p.name
      .normalize('NFD')
      .replace(/\p{Diacritic}/gu, '')
      .toLowerCase()
      .includes(q),
  );
  await route.fulfill({ json: { items: found } });
});
const shot = (name: string) => page.screenshot({ path: resolve(out, `${name}.png`) });

await page.goto(`${base}/find`);
await page.getByRole('heading', { level: 1 }).waitFor();
await shot('01-find-empty');

await page.getByRole('button', { name: 'Search rides' }).click();
await shot('02-find-validation');

await page.getByRole('button', { name: /^From/ }).click();
await page.getByRole('searchbox').waitFor();
await page.waitForTimeout(300);
await shot('03-place-picker-suggestions');

await page.getByRole('searchbox').fill('Selimbar');
await page.getByRole('listitem').first().waitFor();
await page.waitForTimeout(300);
await shot('04-place-picker-selimbar');

await page.getByRole('searchbox').fill('qqqq');
await page.getByText('No match for').first().waitFor();
await shot('05-place-picker-empty');

await page.route('**/places?*', (route) =>
  route.fulfill({ status: 503, json: { error: { code: 'UPSTREAM_ERROR', message: 'x' } } }),
);
await page.getByRole('searchbox').fill('piata');
await page.getByRole('dialog').getByRole('alert').waitFor();
await shot('06-place-picker-error');
await page.keyboard.press('Escape');

for (const [file, path] of [
  ['07-offer', '/offer'],
  ['08-my-rides', '/rides'],
  ['09-profile', '/profile'],
  ['10-not-found', '/nope'],
  ['11-route-map', '/dev/map'],
] as const) {
  await page.goto(`${base}${path}`);
  await page.getByRole('heading', { level: 1 }).waitFor();
  await page.waitForTimeout(800);
  await shot(file);
}

const desktop = await browser.newPage({ viewport: { width: 1280, height: 800 } });
await desktop.goto(`${base}/find`);
await desktop.getByRole('heading', { level: 1 }).waitFor();
await desktop.screenshot({ path: resolve(out, '12-find-desktop.png') });

await browser.close();
console.log(`screenshots: ${out}`);
