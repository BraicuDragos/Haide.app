/**
 * Renders assets/brand/app-icon.svg to the PNG icons the PWA manifest needs, using Playwright's Chromium.
 * Run when the brand icon changes: `pnpm --filter @haide/web icons`. Output is committed (public/icons).
 * The source icon is full-bleed with the glyph inside the maskable safe zone, so one render serves both purposes.
 */
import { mkdirSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';

const here = dirname(fileURLToPath(import.meta.url));
const svg = readFileSync(resolve(here, '../../../assets/brand/app-icon.svg'), 'utf8');
const outDir = resolve(here, '../public/icons');
mkdirSync(outDir, { recursive: true });

const targets: Array<[string, number]> = [
  ['icon-192.png', 192],
  ['icon-512.png', 512],
  ['maskable-512.png', 512],
  ['apple-touch-icon-180.png', 180],
];

const browser = await chromium.launch();
try {
  for (const [name, size] of targets) {
    const page = await browser.newPage({ viewport: { width: size, height: size } });
    await page.setContent(
      `<style>html,body{margin:0}svg{display:block;width:${size}px;height:${size}px}</style>${svg}`,
    );
    await page.screenshot({
      path: resolve(outDir, name),
      clip: { x: 0, y: 0, width: size, height: size },
    });
    await page.close();
  }
} finally {
  await browser.close();
}
console.log(`icons: wrote ${targets.length} files to ${outDir}`);
