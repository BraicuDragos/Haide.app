import { expect, test, type CDPSession, type Page } from '@playwright/test';
import { mockAccountApi, seedSession } from './accounts-helpers';
import { mockPlaces, mockRidesApi, newFakeRides, readyDriver } from './rides-helpers';
import { mockPopularApi } from './popular-helpers';

// Improvement 7: swipe between the four root tabs. Touch is driven through CDP (Input.dispatchTouchEvent), which
// makes Chromium fire real touch pointer events. The page is 360 x 800 (playwright.config.ts).

async function setup(page: Page) {
  await seedSession(page);
  await mockAccountApi(page, readyDriver());
  await mockPlaces(page);
  await mockRidesApi(page, newFakeRides());
  await mockPopularApi(page);
  await page.route('**/telemetry/error', (r) => r.fulfill({ status: 204 }));
}

const sessions = new WeakMap<Page, CDPSession>();

async function touch(
  cdp: CDPSession,
  type: 'touchStart' | 'touchMove' | 'touchEnd',
  x: number,
  y: number,
) {
  await cdp.send('Input.dispatchTouchEvent', {
    type,
    touchPoints: type === 'touchEnd' ? [] : [{ x, y, id: 1 }],
  });
}

/** A finger drag from (x, y) by (dx, dy) in `steps` moves, `gap` ms apart. */
async function drag(page: Page, x: number, y: number, dx: number, dy = 0, gap = 12, steps = 8) {
  let cdp = sessions.get(page);
  if (!cdp) {
    cdp = await page.context().newCDPSession(page);
    sessions.set(page, cdp);
  }
  await touch(cdp, 'touchStart', x, y);
  for (let i = 1; i <= steps; i++) {
    await touch(cdp, 'touchMove', x + (dx * i) / steps, y + (dy * i) / steps);
    await page.waitForTimeout(gap);
  }
  await touch(cdp, 'touchEnd', x + dx, y + dy);
}

/** The slide runs about 300 ms and the page ignores touches while it plays: wait until the direction is cleared. */
const settled = (page: Page) => page.waitForFunction(() => !document.documentElement.dataset.swipe);

const here = (page: Page) => new URL(page.url()).pathname;

test.describe('swipe between tabs (360 x 800, touch)', () => {
  test('left moves to the next tab, right back, ends do nothing, history works', async ({
    page,
  }) => {
    await setup(page);
    await page.goto('/find');
    await expect(page.getByRole('heading', { level: 1 }).first()).toBeVisible();

    await drag(page, 300, 250, -200);
    await expect.poll(() => here(page)).toBe('/offer');
    await settled(page);
    await expect(page.locator('h1:focus')).toHaveCount(1);
    await drag(page, 300, 100, -200);
    await expect.poll(() => here(page)).toBe('/rides');
    await settled(page);
    await drag(page, 100, 100, 200);
    await expect.poll(() => here(page)).toBe('/offer');
    await settled(page);
    await drag(page, 100, 100, 200);
    await expect.poll(() => here(page)).toBe('/find');
    await settled(page);

    // Start of the list: swiping right does nothing.
    await drag(page, 100, 250, 200);
    await page.waitForTimeout(400);
    expect(here(page)).toBe('/find');

    // Browser history behaves like tab taps (push).
    await drag(page, 300, 250, -200);
    await expect.poll(() => here(page)).toBe('/offer');
    await page.goBack();
    await expect.poll(() => here(page)).toBe('/find');
    await settled(page);
  });

  test('end of the list: Profile ignores a left swipe', async ({ page }) => {
    await setup(page);
    await page.goto('/profile');
    await expect(page.getByRole('heading', { level: 1 }).first()).toBeVisible();
    await drag(page, 300, 250, -200);
    await page.waitForTimeout(400);
    expect(here(page)).toBe('/profile');
  });

  test('a fling shorter than the distance threshold still commits', async ({ page }) => {
    await setup(page);
    await page.goto('/find');
    // Synthetic timestamps (seconds): 48 px in 60 ms is 0.8 px/ms, independent of how fast the test runner is.
    const cdp = await page.context().newCDPSession(page);
    const t0 = Date.now() / 1000;
    const pts = (x: number) => [{ x, y: 250, id: 1 }];
    await Promise.all([
      cdp.send('Input.dispatchTouchEvent', {
        type: 'touchStart',
        touchPoints: pts(250),
        timestamp: t0,
      }),
      cdp.send('Input.dispatchTouchEvent', {
        type: 'touchMove',
        touchPoints: pts(234),
        timestamp: t0 + 0.02,
      }),
      cdp.send('Input.dispatchTouchEvent', {
        type: 'touchMove',
        touchPoints: pts(218),
        timestamp: t0 + 0.04,
      }),
      cdp.send('Input.dispatchTouchEvent', {
        type: 'touchMove',
        touchPoints: pts(202),
        timestamp: t0 + 0.06,
      }),
      cdp.send('Input.dispatchTouchEvent', {
        type: 'touchEnd',
        touchPoints: [],
        timestamp: t0 + 0.06,
      }),
    ]);
    await expect.poll(() => here(page)).toBe('/offer');
  });

  test('a short slow drag does not commit', async ({ page }) => {
    await setup(page);
    await page.goto('/find');
    await drag(page, 250, 250, -40, 0, 40);
    await page.waitForTimeout(400);
    expect(here(page)).toBe('/find');
  });

  test('a swipe starting in the outer 24 px does nothing', async ({ page }) => {
    await setup(page);
    await page.goto('/find');
    await drag(page, 10, 250, 200);
    await drag(page, 350, 250, -200);
    await page.waitForTimeout(400);
    expect(here(page)).toBe('/find');
  });

  test('a mostly vertical move never navigates', async ({ page }) => {
    await setup(page);
    await page.goto('/offer');
    await expect(page.getByRole('heading', { level: 1 }).first()).toBeVisible();
    await drag(page, 200, 600, -90, -300);
    await drag(page, 200, 200, 90, 300);
    await page.waitForTimeout(400);
    expect(here(page)).toBe('/offer');
  });

  test('a swipe on a text field does nothing', async ({ page }) => {
    await setup(page);
    await page.goto('/offer');
    const field = page.locator('input:visible').first();
    await expect(field).toBeVisible();
    await field.scrollIntoViewIfNeeded();
    const box = (await field.boundingBox())!;
    await drag(page, box.x + 60, box.y + box.height / 2, -180);
    await page.waitForTimeout(400);
    expect(here(page)).toBe('/offer');
  });

  test('a swipe over an open sheet does nothing', async ({ page }) => {
    await setup(page);
    await page.goto('/find');
    await page.getByRole('button', { name: /^From/ }).click();
    await expect(page.getByRole('dialog')).toBeVisible();
    await drag(page, 300, 700, -200);
    await page.waitForTimeout(400);
    expect(here(page)).toBe('/find');
    await expect(page.getByRole('dialog')).toBeVisible();
  });

  test('a swipe on a screen that is not a root tab does nothing', async ({ page }) => {
    await setup(page);
    await page.goto('/policy/terms');
    await drag(page, 300, 250, -200);
    await page.waitForTimeout(400);
    expect(here(page)).toBe('/policy/terms');
  });

  test('reduced motion: navigates at once and never sets the slide direction', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await setup(page);
    await page.goto('/find');
    await page.evaluate(() => {
      const w = window as unknown as { __swipeAttr?: boolean };
      new MutationObserver(() => {
        if (document.documentElement.dataset.swipe) w.__swipeAttr = true;
      }).observe(document.documentElement, { attributes: true, attributeFilter: ['data-swipe'] });
    });
    await drag(page, 300, 250, -200);
    await expect.poll(() => here(page)).toBe('/offer');
    expect(
      await page.evaluate(() => (window as unknown as { __swipeAttr?: boolean }).__swipeAttr),
    ).toBeFalsy();
  });

  test('with motion on, the direction is set for the slide and cleared afterwards', async ({
    page,
  }) => {
    await page.emulateMedia({ reducedMotion: 'no-preference' });
    await setup(page);
    await page.goto('/find');
    await page.evaluate(() => {
      const w = window as unknown as { __dirs: string[] };
      w.__dirs = [];
      new MutationObserver(() => {
        const d = document.documentElement.dataset.swipe;
        if (d) w.__dirs.push(d);
      }).observe(document.documentElement, { attributes: true, attributeFilter: ['data-swipe'] });
    });
    await drag(page, 300, 250, -200);
    await expect.poll(() => here(page)).toBe('/offer');
    expect(await page.evaluate(() => (window as unknown as { __dirs: string[] }).__dirs)).toEqual([
      'next',
    ]);
    await expect
      .poll(() => page.evaluate(() => document.documentElement.dataset.swipe ?? ''))
      .toBe('');
  });
});
