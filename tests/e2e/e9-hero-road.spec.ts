import { expect, test } from '@playwright/test';
import { mockPlaces } from './rides-helpers';

// Improvement 1: the Find hero line follows a fictional road (straight runs, rounded turns), fitted into the hero
// with one uniform scale. Checked at phone and desktop width, and with reduced motion.

for (const vp of [
  { width: 360, height: 800 },
  { width: 1280, height: 800 },
]) {
  test.describe(`hero road at ${vp.width}x${vp.height}`, () => {
    test.use({ viewport: vp });

    test('the route renders inside the hero and does not move the layout', async ({ page }) => {
      await mockPlaces(page);
      await page.goto('/find');
      const hero = page.locator('.hero');
      const core = page.locator('.hero .rt.core');
      await expect(core).toHaveCount(1);
      const d = (await core.getAttribute('d')) ?? '';
      // straight runs and rounded turns, not one cubic curve
      expect(d).toMatch(/^M[\d. ]+L/);
      expect(d).toContain('Q');
      expect(d).not.toContain('C');

      const h = await hero.boundingBox();
      const r = await core.boundingBox();
      expect(h && r).toBeTruthy();
      expect(r!.x).toBeGreaterThanOrEqual(h!.x - 1);
      expect(r!.x + r!.width).toBeLessThanOrEqual(h!.x + h!.width + 1);
      expect(r!.y).toBeGreaterThanOrEqual(h!.y - 1);
      expect(r!.y + r!.height).toBeLessThanOrEqual(h!.y + h!.height + 1);

      // sampling still works (the travelling lights read the path)
      const len = await core.evaluate((el) => (el as SVGGeometryElement).getTotalLength());
      expect(len).toBeGreaterThan(100);

      // the hero height is the same before and after the art mounts (no layout shift)
      await page.waitForTimeout(500);
      const h2 = await hero.boundingBox();
      expect(Math.round(h2!.height)).toBe(Math.round(h!.height));
    });

    test('reduced motion: fully drawn route, nothing animates', async ({ page }) => {
      await page.emulateMedia({ reducedMotion: 'reduce' });
      await mockPlaces(page);
      await page.goto('/find');
      const core = page.locator('.hero .rt.core');
      await expect(core).toHaveCount(1);
      await page.waitForTimeout(600);
      const running = await page.evaluate(
        () => document.querySelector('.hero')?.getAnimations({ subtree: true }).length ?? -1,
      );
      expect(running).toBe(0);
      const dash = await core.evaluate((el) => getComputedStyle(el).strokeDashoffset);
      expect(parseFloat(dash)).toBe(0);
    });
  });
}
