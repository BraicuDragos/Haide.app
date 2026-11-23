import type { Page } from '@playwright/test';
import { PLACES } from './rides-helpers';

/** One item of GET /popular-routes (contract: places as the gazetteer returns them, `rides` 0 for curated ones). */
export interface PopularItem {
  from: (typeof PLACES)[number];
  to: (typeof PLACES)[number];
  rides: number;
  source: 'data' | 'curated';
}

const [SELIMBAR, ZI_VEST, PIATA_MARE] = PLACES as [
  (typeof PLACES)[number],
  (typeof PLACES)[number],
  (typeof PLACES)[number],
];

export const POPULAR_DEFAULT: PopularItem[] = [
  { from: SELIMBAR, to: ZI_VEST, rides: 6, source: 'data' },
  { from: PIATA_MARE, to: SELIMBAR, rides: 0, source: 'curated' },
];

export interface FakePopular {
  items: PopularItem[];
  /** Every request answers with this status until it is cleared (the client retries a 5xx once). */
  fail?: number;
  /** Hold the next request until released (loading state). */
  hold?: Promise<void>;
  calls: number;
}

export function newFakePopular(items: PopularItem[] = POPULAR_DEFAULT): FakePopular {
  return { items, calls: 0 };
}

/** Mocks GET /popular-routes (public). */
export async function mockPopularApi(page: Page, fake: FakePopular = newFakePopular()) {
  await page.route('**/api/v1/popular-routes*', async (route) => {
    if (route.request().method() === 'OPTIONS') return route.fulfill({ status: 204 });
    fake.calls += 1;
    if (fake.hold) await fake.hold;
    if (fake.fail) {
      const status = fake.fail;
      return route.fulfill({
        status,
        json: { error: { code: 'UNKNOWN', message: 'x', requestId: 'r' } },
      });
    }
    return route.fulfill({ json: { items: fake.items } });
  });
  return fake;
}
