import type { Page, Route } from '@playwright/test';
import { publicUser } from './accounts-helpers';

/** Trip B ride on the west corridor (Șelimbăr to Zona Industrială Vest, 3 seats, diesel): 3.10 / 2.00 / 1.50 RON. */
export const RIDE_ID = '5d1f7c64-3b0e-4a57-9f3a-0c2a6b7d1e01';
export const DRIVER = publicUser({
  id: '8a1c2d3e-0000-4000-8000-000000000002',
  firstName: 'Radu',
  rating: { average: 4.8, count: 23 },
  ridesCompleted: 23,
});

const approx = (lat: number, lng: number) => ({ lat, lng, approx: true, radiusM: 300 });

/** Tomorrow 07:25 Bucharest, as an instant. Ten days ahead is not needed: the fake ignores the date. */
function tomorrowAt(h: number, m: number): string {
  const d = new Date(Date.now() + 24 * 3600 * 1000);
  const [y, mo, da] = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Bucharest' })
    .format(d)
    .split('-')
    .map(Number) as [number, number, number];
  // Bucharest is UTC+2 or +3: aim for the right wall clock by trying both offsets.
  for (const off of [2, 3]) {
    const t = new Date(Date.UTC(y, mo - 1, da, h - off, m));
    const wall = new Intl.DateTimeFormat('en-GB', {
      timeZone: 'Europe/Bucharest',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    }).format(t);
    if (wall === `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`)
      return t.toISOString();
  }
  return new Date(Date.UTC(y, mo - 1, da, h - 2, m)).toISOString();
}

export function tripBItem(over: Record<string, unknown> = {}) {
  return {
    rideId: RIDE_ID,
    departureAt: tomorrowAt(7, 25),
    pickupEtaAt: tomorrowAt(7, 30),
    pickup: { point: approx(45.7595, 24.2128), label: 'Șelimbăr, Shopping City area', walkM: 150 },
    dropoff: { point: approx(45.7926, 24.0973), label: 'Zona Industrială Vest', walkM: 100 },
    segmentM: 9588,
    priceUpToBani: 310,
    isFree: false,
    seatsLeft: 2,
    driver: {
      id: DRIVER.id,
      firstName: DRIVER.firstName,
      photoUrl: null,
      rating: DRIVER.rating,
    },
    ...over,
  };
}

export function publicRide(over: Record<string, unknown> = {}) {
  return {
    id: RIDE_ID,
    status: 'published',
    departureAt: tomorrowAt(7, 25),
    durationS: 1020,
    distanceM: 9588,
    origin: { point: approx(45.7595, 24.2128), label: 'Șelimbăr' },
    destination: { point: approx(45.7926, 24.0973), label: 'Zona Industrială Vest' },
    routePublic: {
      type: 'LineString',
      coordinates: [
        [24.2128, 45.7595],
        [24.15, 45.78],
        [24.0973, 45.7926],
      ],
    },
    seatsOffered: 3,
    seatsLeft: 2,
    note: 'Blue backpack on the dashboard. I wait at the Shopping City bus stop.',
    isFree: false,
    priceTable: [
      { passengers: 1, priceBani: 310 },
      { passengers: 2, priceBani: 200 },
      { passengers: 3, priceBani: 150 },
    ],
    car: { make: 'Dacia', model: 'Logan', colour: 'Grey' },
    driver: DRIVER,
    viewer: { isDriver: false, bookingId: null, bookingStatus: null, blocked: false },
    ...over,
  };
}

export interface FakeSearch {
  /** Bodies seen by POST /search and POST /rides/{id}/match. */
  searches: Array<Record<string, unknown>>;
  matches: Array<Record<string, unknown>>;
  items: unknown[];
  nearest: unknown[];
  hiddenBlockedCount: number;
  ride: Record<string, unknown> | null;
  match: Record<string, unknown>;
  /** One-shot failures. */
  failNextSearch?: [number, string];
  failNextMatch?: [number, string];
  /** Hold the next search until released (for the loading state). */
  holdSearch?: Promise<void>;
}

export function newFakeSearch(): FakeSearch {
  return {
    searches: [],
    matches: [],
    items: [tripBItem()],
    nearest: [],
    hiddenBlockedCount: 0,
    ride: publicRide(),
    match: {
      pickup: {
        point: approx(45.7595, 24.2128),
        label: 'Șelimbăr, Shopping City area',
        walkM: 150,
      },
      dropoff: { point: approx(45.7926, 24.0973), label: 'Zona Industrială Vest', walkM: 100 },
      segmentM: 9588,
      priceUpToBani: 310,
      pickupEtaAt: tomorrowAt(7, 30),
      seatsLeft: 2,
      bookable: true,
      notBookableReason: null,
    },
  };
}

const err = (route: Route, status: number, code: string) =>
  route.fulfill({ status, json: { error: { code, message: code, requestId: 'r' } } });

/** Mocks the E3 endpoints (api-contract section 2): POST /search, GET /rides/{id}, POST /rides/{id}/match. */
export async function mockSearchApi(page: Page, fake: FakeSearch) {
  await page.route('**/api/v1/search', async (route) => {
    const req = route.request();
    if (req.method() === 'OPTIONS') return route.fulfill({ status: 204 });
    if (fake.holdSearch) await fake.holdSearch;
    if (fake.failNextSearch) {
      const [s, c] = fake.failNextSearch;
      fake.failNextSearch = undefined;
      return err(route, s, c);
    }
    fake.searches.push(req.postDataJSON() as Record<string, unknown>);
    return route.fulfill({
      json: {
        items: fake.items,
        // Contract: always present, empty unless `items` is empty.
        nearestOutsideWindow: fake.items.length === 0 ? fake.nearest : [],
        hiddenBlockedCount: fake.hiddenBlockedCount,
      },
    });
  });
  await page.route(`**/api/v1/rides/${RIDE_ID}/match`, async (route) => {
    const req = route.request();
    if (req.method() === 'OPTIONS') return route.fulfill({ status: 204 });
    if (fake.failNextMatch) {
      const [s, c] = fake.failNextMatch;
      fake.failNextMatch = undefined;
      return err(route, s, c);
    }
    fake.matches.push(req.postDataJSON() as Record<string, unknown>);
    return route.fulfill({ json: fake.match });
  });
  await page.route(`**/api/v1/rides/${RIDE_ID}`, async (route) => {
    if (route.request().method() === 'OPTIONS') return route.fulfill({ status: 204 });
    if (!fake.ride) return err(route, 404, 'NOT_FOUND');
    return route.fulfill({ json: fake.ride });
  });
}
