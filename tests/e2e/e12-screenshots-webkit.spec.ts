import { expect, test } from '@playwright/test';
import { mockPopularApi } from './popular-helpers';
import { mockPlaces } from './rides-helpers';

// Not a regression test: regenerates docs/screenshots/ios-width/*.png. Skipped unless E12_SHOTS=1.
// BEFORE replaces the custom time button with the pre-PR-28 markup (a native input type=time). Playwright's WebKit
// on Windows does not render the native iOS control, so BEFORE is a faithful DOM reproduction, not an iPhone capture.
test.skip(process.env.E12_SHOTS !== '1', 'screenshot generator, set E12_SHOTS=1');

for (const width of [320, 375, 430]) {
  for (const state of ['before', 'after'] as const) {
    test(`screenshot Find ${state} at ${width}px`, async ({ page }) => {
      await page.setViewportSize({ width, height: 800 });
      await page.route('**/telemetry/error', (r) => r.fulfill({ status: 204 }));
      await mockPlaces(page);
      await mockPopularApi(page);
      await page.goto('/find');
      await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
      if (state === 'before') {
        await page.evaluate(() => {
          const btn = document.getElementById('find-time');
          const wrap = btn?.parentElement;
          if (!btn || !wrap) return;
          const input = document.createElement('input');
          input.type = 'time';
          input.id = 'find-time';
          input.className = 'control min-h-12 border border-border-strong';
          // Undo today's hardening so the old behaviour is reproduced: auto min-width, native appearance, 1fr columns.
          input.style.cssText = 'min-width:auto;max-width:none;width:100%;appearance:auto;';
          btn.replaceWith(input);
          const row = input.closest('.grid') as HTMLElement | null;
          const day = document.getElementById('find-day')?.parentElement;
          if (day) day.style.minWidth = 'auto';
          wrap.style.minWidth = 'auto';
          if (row) row.style.gridTemplateColumns = 'repeat(2, 1fr)';
        });
      }
      await page.screenshot({
        path: `docs/screenshots/ios-width/find-${state}-${width}.png`,
        fullPage: false,
      });
    });
  }
}
