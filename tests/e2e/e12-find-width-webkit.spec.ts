import { expect, test, type Page } from '@playwright/test';
import { mockPopularApi } from './popular-helpers';
import { mockAccountApi, seedSession } from './accounts-helpers';
import { mockPlaces, mockRidesApi, newFakeRides, readyDriver } from './rides-helpers';

// iOS layout regression (improvements round 2, item 2): the day / time rows of Find ("Leave around"), Publish
// ("Leaving at") and the repeat "until" date, on the WebKit engine at iPhone widths. No element may stick out of the
// viewport, the page must not scroll sideways, and the two-column row must end where its neighbours end. Runs in the
// `webkit-iphone` project. Playwright's WebKit does not render native iOS pickers, so "guard works" tests inject a
// deliberately overflowing control to prove the measurement would catch a regression.

const WIDTHS = [320, 375, 390, 430] as const;

type Box = { left: number; right: number; width: number; height: number };
type Measure = Awaited<ReturnType<typeof measure>>;

/** Measures overflow and the geometry of the named elements. Shared by every test (and by the guard tests). */
async function measure(page: Page, ids: string[]) {
  return await page.evaluate((idList) => {
    const vw = document.documentElement.clientWidth;
    const rect = (el: Element | null) => {
      if (!el) return null;
      const r = el.getBoundingClientRect();
      return { left: r.left, right: r.right, width: r.width, height: r.height };
    };
    const outside: string[] = [];
    for (const el of Array.from(document.body.querySelectorAll('*'))) {
      const r = el.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) continue;
      const cs = getComputedStyle(el);
      if (cs.visibility === 'hidden' || cs.display === 'none') continue;
      // Elements the user can never see sideways (clipped by an ancestor with overflow hidden) are not a problem.
      let clipped = false;
      for (let p = el.parentElement; p && p !== document.body; p = p.parentElement) {
        const o = getComputedStyle(p).overflowX;
        if (o === 'hidden' || o === 'auto' || o === 'scroll' || o === 'clip') {
          const pr = p.getBoundingClientRect();
          if (pr.right <= vw + 0.5 && pr.left >= -0.5) {
            clipped = true;
            break;
          }
        }
      }
      if (!clipped && (r.right > vw + 0.5 || r.left < -0.5)) {
        outside.push(
          `${el.tagName.toLowerCase()}${el.id ? '#' + el.id : ''}.${String(el.getAttribute('class') ?? '').slice(0, 40)} [${Math.round(r.left)}..${Math.round(r.right)}]`,
        );
      }
    }
    const boxes: Record<string, Box | null> = {};
    for (const id of idList) boxes[id] = rect(document.getElementById(id));
    return {
      vw,
      scrollWidth: document.documentElement.scrollWidth,
      bodyScrollWidth: document.body.scrollWidth,
      outside: outside.slice(0, 8),
      boxes,
      field: rect(document.querySelector('form button')),
    };
  }, ids);
}

function expectFits(m: Measure) {
  const note = JSON.stringify(m);
  expect(m.scrollWidth, `document scrolls sideways: ${note}`).toBeLessThanOrEqual(m.vw);
  expect(m.bodyScrollWidth, `body scrolls sideways: ${note}`).toBeLessThanOrEqual(m.vw);
  expect(m.outside, `elements outside the viewport: ${note}`).toEqual([]);
}

function expectRow(m: Measure, left: string, right: string) {
  const note = JSON.stringify(m);
  const l = m.boxes[left] as Box;
  const r = m.boxes[right] as Box;
  const field = m.field as Box; // the From field: the content edges of the form
  expect(Math.abs(r.right - field.right), `right margin differs: ${note}`).toBeLessThanOrEqual(1);
  expect(Math.abs(l.left - field.left), `left margin differs: ${note}`).toBeLessThanOrEqual(1);
  expect(Math.abs(r.width - l.width), `columns differ: ${note}`).toBeLessThanOrEqual(1);
  expect(Math.abs(r.height - l.height), `heights differ: ${note}`).toBeLessThanOrEqual(0.5);
}

async function openFind(page: Page, width: number) {
  await page.setViewportSize({ width, height: 800 });
  await page.route('**/telemetry/error', (r) => r.fulfill({ status: 204 }));
  await mockPlaces(page);
  await mockPopularApi(page);
  await page.goto('/find');
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
}

async function openPublish(page: Page, width: number) {
  await page.setViewportSize({ width, height: 800 });
  await page.route('**/telemetry/error', (r) => r.fulfill({ status: 204 }));
  await seedSession(page);
  await mockAccountApi(page, readyDriver());
  await mockPlaces(page);
  await mockRidesApi(page, newFakeRides());
  await page.goto('/offer');
  await expect(page.getByRole('heading', { level: 1, name: 'Offer a ride' })).toBeVisible();
  await expect(page.locator('#offer-time')).toBeVisible();
}

const FIND_IDS = ['find-day', 'find-time'];
const PUBLISH_IDS = ['offer-day', 'offer-time'];

for (const width of WIDTHS) {
  test(`Find at ${width}px: no horizontal overflow, "Leave around" fits its column`, async ({
    page,
  }) => {
    await openFind(page, width);
    const m = await measure(page, FIND_IDS);
    expectFits(m);
    expectRow(m, 'find-day', 'find-time');
  });

  test(`Publish at ${width}px: no horizontal overflow, "Leaving at" fits its column`, async ({
    page,
  }) => {
    await openPublish(page, width);
    const m = await measure(page, PUBLISH_IDS);
    expectFits(m);
    expectRow(m, 'offer-day', 'offer-time');
  });

  test(`Publish repeat "until" date at ${width}px stays inside the viewport`, async ({ page }) => {
    await openPublish(page, width);
    await page.getByRole('switch', { name: /Repeat on weekdays/ }).click();
    await expect(page.locator('#offer-until')).toBeVisible();
    const m = await measure(page, ['offer-until', 'offer-day']);
    expectFits(m);
    const until = m.boxes['offer-until'] as Box;
    expect(until.right).toBeLessThanOrEqual(m.vw);
    expect(until.left).toBeGreaterThanOrEqual(0);
    // Symmetric side margins: the field is not pushed to one side.
    expect(Math.abs(until.left - (m.vw - until.right))).toBeLessThanOrEqual(1);
  });
}

// Dynamic Type simulation: the app sets no root font size (type tokens are px), so scaling the root does nothing.
// Large text is simulated on the body and the controls instead, which is what iOS enlarges.
const LARGE_TEXT =
  'body{font-size:22px !important} .control, .control *{font-size:22px !important}';

test('Find at 320px with large text: still no overflow', async ({ page }) => {
  await openFind(page, 320);
  await page.addStyleTag({ content: LARGE_TEXT });
  const m = await measure(page, FIND_IDS);
  expectFits(m);
  expectRow(m, 'find-day', 'find-time');
});

test('Publish at 320px with large text: still no overflow', async ({ page }) => {
  await openPublish(page, 320);
  await page.addStyleTag({ content: LARGE_TEXT });
  const m = await measure(page, PUBLISH_IDS);
  expectFits(m);
  expectRow(m, 'offer-day', 'offer-time');
});

// Guard checks: the same measurement must report a deliberately overflowing control.
test('guard works: an injected 520px date input is reported as overflow (Find, 375px)', async ({
  page,
}) => {
  await openFind(page, 375);
  await page.evaluate(() => {
    const input = document.createElement('input');
    input.type = 'date';
    input.id = 'guard-wide';
    input.style.width = '520px';
    input.style.minWidth = '520px';
    input.style.maxWidth = 'none';
    document.getElementById('find-day')?.parentElement?.appendChild(input);
  });
  const m = await measure(page, FIND_IDS);
  expect(m.scrollWidth > m.vw || m.outside.length > 0).toBe(true);
  expect(m.outside.join(' ')).toContain('guard-wide');
});

test('guard works: a wide "Leaving at" column breaks the row check (Publish, 375px)', async ({
  page,
}) => {
  await openPublish(page, 375);
  await page.evaluate(() => {
    const el = document.getElementById('offer-time');
    if (el) {
      el.style.minWidth = '420px';
      el.style.maxWidth = 'none';
    }
  });
  const m = await measure(page, PUBLISH_IDS);
  const time = m.boxes['offer-time'] as Box;
  const day = m.boxes['offer-day'] as Box;
  const overflow = m.scrollWidth > m.vw || m.outside.length > 0;
  const misaligned = Math.abs(time.width - day.width) > 1;
  expect(overflow || misaligned).toBe(true);
});
