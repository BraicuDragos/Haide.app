import { expect, test, type Page } from '@playwright/test';
import { expectNoAxeViolations } from './accounts-helpers';
import { mockPopularApi, newFakePopular } from './popular-helpers';
import { mockPlaces } from './rides-helpers';
import { mockSearchApi, newFakeSearch } from './search-helpers';

// E10-4, popular routes on the Find screen (signed out, 360x800). The API is mocked: the ranking rules live in the
// backend tests. These specs check what the person sees and that a tap lands on prefilled results.

const heading = (page: Page, name: string | RegExp, level = 1) =>
  page.getByRole('heading', { level, name });

async function setup(page: Page) {
  await page.route('**/telemetry/error', (r) => r.fulfill({ status: 204 }));
  await mockPlaces(page);
  const search = newFakeSearch();
  await mockSearchApi(page, search);
  return search;
}

test.describe('popular routes', () => {
  test('lists real routes with a count and curated ones without; accessible and large enough', async ({
    page,
  }) => {
    await setup(page);
    await mockPopularApi(page);
    await page.goto('/find');
    await expect(heading(page, 'Popular routes', 2)).toBeVisible();
    const real = page.getByRole('button', { name: 'Șelimbăr to Zona Industrială Vest' });
    const curated = page.getByRole('button', { name: 'Piața Mare to Șelimbăr' });
    await expect(real).toBeVisible();
    await expect(curated).toBeVisible();
    await expect(real).toContainText('6 rides lately');
    await expect(curated).not.toContainText('rides');
    for (const b of [real, curated]) {
      const box = await b.boundingBox();
      expect(box?.height ?? 0).toBeGreaterThanOrEqual(48);
    }
    // No horizontal scroll at 360 px.
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
    );
    expect(overflow).toBe(false);
    await expectNoAxeViolations(page);
  });

  test('a tap opens prefilled results: today, next free slot, plus or minus one hour', async ({
    page,
  }) => {
    const search = await setup(page);
    await mockPopularApi(page);
    await page.goto('/find');
    await page.getByRole('button', { name: 'Șelimbăr to Zona Industrială Vest' }).click();
    await expect(page).toHaveURL(/\/results$/);
    await expect(heading(page, '1 ride found')).toBeVisible();
    expect(search.searches).toHaveLength(1);
    const body = search.searches[0] as { time: string; windowMin: number; date: string };
    expect(body.windowMin).toBe(60);
    expect(body.time).toMatch(/^\d{2}:\d{2}$/);
    expect(Number(body.time.slice(3)) % 5).toBe(0);
    await expectNoAxeViolations(page);
  });

  test('loading shows a busy state, then the list', async ({ page }) => {
    await setup(page);
    let release!: () => void;
    const fake = newFakePopular();
    fake.hold = new Promise<void>((r) => (release = r));
    await mockPopularApi(page, fake);
    await page.goto('/find');
    await expect(page.getByRole('region', { name: 'Popular routes' })).toHaveAttribute(
      'aria-busy',
      'true',
    );
    await expect(page.getByText('Loading popular routes')).toBeVisible();
    release();
    await expect(
      page.getByRole('button', { name: 'Șelimbăr to Zona Industrială Vest' }),
    ).toBeVisible();
  });

  test('an error offers Try again and recovers', async ({ page }) => {
    await setup(page);
    const fake = newFakePopular();
    fake.fail = 500;
    await mockPopularApi(page, fake);
    await page.goto('/find');
    await expect(page.getByRole('alert').filter({ hasText: 'popular routes' })).toBeVisible();
    await expectNoAxeViolations(page);
    fake.fail = undefined;
    await page.getByRole('button', { name: 'Try again' }).click();
    await expect(
      page.getByRole('button', { name: 'Șelimbăr to Zona Industrială Vest' }),
    ).toBeVisible();
  });

  test('an empty answer shows a calm text', async ({ page }) => {
    await setup(page);
    await mockPopularApi(page, newFakePopular([]));
    await page.goto('/find');
    await expect(page.getByText('No popular routes yet.', { exact: false })).toBeVisible();
    await expectNoAxeViolations(page);
  });
});
