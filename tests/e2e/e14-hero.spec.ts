import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { mockPlaces } from './rides-helpers';

// Improvement 2: the Find hero is a "night city" scene (three parallax street layers, one lit route, ambient lights,
// pins that ripple, a one-time sweep of light, twinkling distant lights). Checked at phone and desktop width, in dark
// and light, with OS and in-app reduced motion, and that nothing keeps running after leaving the screen.
// HERO_SHOTS=1 also writes the review frames to docs/screenshots/find-polish/.

const loops = (page: Page) =>
  page.evaluate(
    () =>
      document
        .querySelector('.hero')
        ?.getAnimations({ subtree: true })
        .filter(
          (a) => a.effect?.getComputedTiming().iterations === Infinity && a.playState === 'running',
        ).length ?? -1,
  );
const anyAnim = (page: Page) =>
  page.evaluate(
    () => document.querySelector('.hero')?.getAnimations({ subtree: true }).length ?? -1,
  );
const layerShifts = (page: Page) =>
  page.evaluate(() =>
    [...document.querySelectorAll<HTMLElement>('.hero-art .hp')].map((l) => {
      const m = /translate3d\((-?[\d.]+)px/.exec(l.style.transform);
      return m ? Number(m[1]) : 0;
    }),
  );

test.beforeEach(async ({ page }) => {
  await page.route('**/telemetry/error', (route) => route.fulfill({ status: 204 }));
  await mockPlaces(page);
});

for (const vp of [
  { width: 360, height: 800 },
  { width: 1280, height: 800 },
]) {
  test.describe(`hero scene at ${vp.width}x${vp.height}`, () => {
    test.use({ viewport: vp });

    test('renders inside the hero box, no overflow, no layout shift, at most 12 loops', async ({
      page,
    }) => {
      await page.goto('/find');
      const hero = page.locator('.hero');
      await expect(page.locator('.hero .hp')).toHaveCount(3);
      const h = (await hero.boundingBox())!;
      const art = (await page.locator('.hero-art').boundingBox())!;
      expect(Math.abs(art.width - h.width)).toBeLessThanOrEqual(1);
      expect(Math.abs(art.height - h.height)).toBeLessThanOrEqual(1);
      const core = (await page.locator('.hero .rt.core').boundingBox())!;
      expect(core.x).toBeGreaterThanOrEqual(h.x - 1);
      expect(core.x + core.width).toBeLessThanOrEqual(h.x + h.width + 1);
      expect(core.y + core.height).toBeLessThanOrEqual(h.y + h.height + 1);
      // the layers are bled past the box but clipped by it: no page scroll
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
        ),
      ).toBe(false);
      await page.waitForTimeout(1500);
      const h2 = (await hero.boundingBox())!;
      expect(Math.round(h2.height)).toBe(Math.round(h.height));
      const n = await loops(page);
      expect(n).toBeGreaterThan(5);
      expect(n).toBeLessThanOrEqual(12);
    });

    test('parallax follows the pointer, deeper layers move further', async ({ page }) => {
      await page.goto('/find');
      await page.waitForTimeout(300);
      await page.mouse.move(vp.width * 0.05, 100);
      await page.mouse.move(vp.width * 0.06, 110);
      await page.waitForTimeout(900);
      const [far, mid, near] = await layerShifts(page);
      expect(Math.abs(far!)).toBeLessThan(Math.abs(mid!));
      expect(Math.abs(mid!)).toBeLessThan(Math.abs(near!));
      expect(Math.abs(near!)).toBeLessThanOrEqual(16.01);
      expect(near!).toBeGreaterThan(0); // pointer left: the scene moves right
    });

    test('OS reduced motion: still finished picture, nothing animates, no parallax', async ({
      page,
    }) => {
      await page.emulateMedia({ reducedMotion: 'reduce' });
      await page.goto('/find');
      await expect(page.locator('.hero .rt.core')).toHaveCount(1);
      await page.mouse.move(10, 100);
      await page.mouse.move(20, 120);
      await page.waitForTimeout(700);
      expect(await anyAnim(page)).toBe(0);
      expect(await layerShifts(page)).toEqual([0, 0, 0]);
      const dash = await page
        .locator('.hero .rt.core')
        .evaluate((el) => getComputedStyle(el).strokeDashoffset);
      expect(parseFloat(dash)).toBe(0);
      const lights = await page
        .locator('.hero .tl')
        .evaluateAll((els) => els.map((e) => Number(getComputedStyle(e).opacity)));
      expect(lights.every((o) => o > 0.5)).toBe(true);
      const rings = await page
        .locator('.hero .rp.pk')
        .evaluate((e) => Number(getComputedStyle(e).opacity));
      expect(rings).toBeGreaterThan(0.3);
    });

    test('in-app Reduce motion switch is honoured (and wins over the OS)', async ({ page }) => {
      await page.emulateMedia({ reducedMotion: 'no-preference' });
      await page.addInitScript(() => window.localStorage.setItem('haide.motion', 'reduced'));
      await page.goto('/find');
      await expect(page.locator('.hero .rt.core')).toHaveCount(1);
      await page.mouse.move(10, 100);
      await page.mouse.move(20, 120);
      await page.waitForTimeout(700);
      expect(await anyAnim(page)).toBe(0);
      expect(await layerShifts(page)).toEqual([0, 0, 0]);
    });

    test('switching Reduce motion on while the hero is open stops everything', async ({ page }) => {
      await page.goto('/find');
      await page.waitForTimeout(800);
      expect(await loops(page)).toBeGreaterThan(0);
      await page.evaluate(() => {
        window.localStorage.setItem('haide.motion', 'reduced');
        document.documentElement.dataset.motion = 'reduced';
        document.getAnimations().forEach((a) => a.cancel());
      });
      await page.waitForTimeout(300);
      expect(await anyAnim(page)).toBe(0);
    });

    test('animations are cleaned up when leaving the screen', async ({ page }) => {
      await page.goto('/find');
      await page.waitForTimeout(800);
      expect(await loops(page)).toBeGreaterThan(0);
      await page
        .getByRole('navigation', { name: 'Main' })
        .getByRole('link', { name: /Profile|Account/i })
        .first()
        .click();
      await expect(page.locator('.hero')).toHaveCount(0);
      const left = await page.evaluate(
        () =>
          document
            .getAnimations()
            .filter((a) => (a.effect as KeyframeEffect | null)?.target?.closest?.('.hero-art'))
            .length,
      );
      expect(left).toBe(0);
    });

    test('loops pause while the tab is hidden', async ({ page }) => {
      await page.goto('/find');
      await page.waitForTimeout(800);
      expect(await loops(page)).toBeGreaterThan(0);
      await page.evaluate(() => {
        Object.defineProperty(document, 'hidden', { configurable: true, get: () => true });
        document.dispatchEvent(new Event('visibilitychange'));
      });
      await page.waitForTimeout(200);
      expect(await loops(page)).toBe(0);
    });
  });
}

for (const theme of ['dark', 'light'] as const) {
  test(`${theme}: hero is axe clean (headline contrast with the sweep running)`, async ({
    page,
  }) => {
    await page.addInitScript((t) => window.localStorage.setItem('haide.theme', t), theme);
    await page.goto('/find');
    // axe at several moments of the one-time sweep and the draw
    for (const wait of [350, 700, 900]) {
      await page.waitForTimeout(wait);
      const res = await new AxeBuilder({ page }).include('.hero').analyze();
      expect(res.violations, JSON.stringify(res.violations.map((v) => v.id))).toEqual([]);
    }
  });
}

if (process.env.HERO_SHOTS) {
  for (const theme of ['dark', 'light'] as const) {
    test(`frames: ${theme}`, async ({ browser }) => {
      const ctx = await browser.newContext({
        viewport: { width: 360, height: 800 },
        deviceScaleFactor: 2,
        hasTouch: true,
      });
      const page = await ctx.newPage();
      await page.route('**/telemetry/error', (route) => route.fulfill({ status: 204 }));
      await mockPlaces(page);
      await page.addInitScript((t) => window.localStorage.setItem('haide.theme', t), theme);
      await page.goto('/find');
      const t0 = Date.now();
      const frames: Array<['early' | 'mid' | 'settled', number]> = [
        ['early', 700],
        ['mid', 1500],
        ['settled', 5200],
      ];
      for (const [name, at] of frames) {
        const wait = at - (Date.now() - t0);
        if (wait > 0) await page.waitForTimeout(wait);
        await page.locator('.hero').screenshot({
          path: `docs/screenshots/find-polish/hero-${theme}-${name}.png`,
        });
      }
      await ctx.close();
    });
  }
}
