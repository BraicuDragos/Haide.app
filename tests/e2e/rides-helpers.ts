import type { Page, Route } from '@playwright/test';
import { newAccount, PNG_1X1, type FakeAccount } from './accounts-helpers';

/** Gazetteer for the mocked GET /places: the two Trip B ends plus the old town. */
export const PLACES = [
  {
    id: 'p-selimbar',
    name: 'Șelimbăr',
    secondary: 'Shopping City',
    kind: 'area',
    point: { lat: 45.7595, lng: 24.2128 },
    areaName: 'Șelimbăr',
  },
  {
    id: 'p-zi-vest',
    name: 'Zona Industrială Vest',
    secondary: 'Str. Salzburg',
    kind: 'area',
    point: { lat: 45.7926, lng: 24.0973 },
    areaName: 'Zona Industrială Vest',
  },
  {
    id: 'p-piata-mare',
    name: 'Piața Mare',
    secondary: 'Old town',
    kind: 'poi',
    point: { lat: 45.7972, lng: 24.1521 },
    areaName: 'Centru',
  },
];

const fold = (s: string) =>
  s
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase();

export async function mockPlaces(page: Page) {
  await page.route('**/places?*', (route: Route) => {
    const q = fold(new URL(route.request().url()).searchParams.get('q') ?? '');
    return route.fulfill({ json: { items: PLACES.filter((p) => fold(p.name).includes(q)) } });
  });
}

/** A driver who can publish: consent, profile and a 3-seat diesel car (Trip B prices are for this car). */
export function readyDriver(): FakeAccount {
  const acc = newAccount({
    consent: { upToDate: true, required: [] },
    firstName: 'Ioana',
    phoneE164: '+40721234567',
    photoUrl: `data:image/png;base64,${PNG_1X1.toString('base64')}`,
    profileComplete: true,
    hasVehicle: true,
  });
  acc.vehicle = {
    make: 'Dacia',
    model: 'Logan',
    colour: 'Grey',
    plate: 'SB12ABC',
    fuelType: 'diesel',
    seats: 3,
  };
  return acc;
}

type FakeRide = Record<string, unknown> & { id: string; status: string; departureAt: string };

/**
 * Stateful fake of the E2 endpoints (api-contract section 4), in step with the server rules the UI mirrors.
 * Trip B (Șelimbăr, Shopping City to Zona Industrială Vest, 9 588 m, 17 min, diesel, 3 seats) prices to the bani:
 * 3.10 / 2.00 / 1.50 RON, trip cost 6.24 RON (docs/product/pricing.md). ROUTING_PROVIDER=fixture on the real stack
 * returns the same figures.
 */
export interface FakeRides {
  rides: FakeRide[];
  /** Bodies seen by POST /rides. */
  published: Array<Record<string, unknown>>;
  previews: number;
  /** One-shot failures: the next call to that endpoint answers with this status and code. */
  failNext: {
    preview?: [number, string];
    publish?: [number, string];
    cancel?: [number, string];
    edit?: [number, string];
  };
  /** Bodies seen by PATCH /rides/{id}. */
  edits: Array<Record<string, unknown>>;
  now: () => number;
}

export function newFakeRides(): FakeRides {
  return { rides: [], published: [], edits: [], previews: 0, failNext: {}, now: () => Date.now() };
}

export const TRIP_B = {
  distanceM: 9588,
  durationS: 1020,
  tripCostBani: 624,
  priceTable: [
    { passengers: 1, priceBani: 310 },
    { passengers: 2, priceBani: 200 },
    { passengers: 3, priceBani: 150 },
  ],
};

const err = (route: Route, status: number, code: string, fields?: Record<string, string>) =>
  route.fulfill({
    status,
    json: { error: { code, message: code, requestId: 'r', ...(fields ? { fields } : {}) } },
  });

const line = (a: { lat: number; lng: number }, b: { lat: number; lng: number }) => ({
  type: 'LineString',
  coordinates: [
    [a.lng, a.lat],
    [(a.lng + b.lng) / 2, (a.lat + b.lat) / 2 + 0.01],
    [b.lng, b.lat],
  ],
});

export async function mockRidesApi(page: Page, fake: FakeRides) {
  const previews = new Map<string, Record<string, unknown>>();
  await page.route(
    (url) => /\/api\/v1\/(me\/)?rides(\/|$)/.test(url.pathname),
    async (route) => {
      const req = route.request();
      const url = new URL(req.url());
      const path = url.pathname.replace(/^.*\/api\/v1/, '');
      const method = req.method();
      if (method === 'OPTIONS') return route.fulfill({ status: 204 });

      if (method === 'POST' && path === '/rides/preview') {
        const fail = fake.failNext.preview;
        if (fail) {
          fake.failNext.preview = undefined;
          return err(route, fail[0], fail[1]);
        }
        const b = req.postDataJSON() as {
          origin: { lat: number; lng: number };
          destination: { lat: number; lng: number };
          originLabel?: string;
          destinationLabel?: string;
        };
        if (b.origin.lat === b.destination.lat && b.origin.lng === b.destination.lng)
          return err(route, 400, 'SAME_PLACE');
        fake.previews += 1;
        const previewId = `00000000-0000-4000-8000-${String(fake.previews).padStart(12, '0')}`;
        const body = {
          previewId,
          expiresAt: new Date(fake.now() + 30 * 60_000).toISOString(),
          ...TRIP_B,
          route: line(b.origin, b.destination),
          originLabel: b.originLabel ?? 'Șelimbăr, Shopping City',
          destinationLabel: b.destinationLabel ?? 'Zona Industrială Vest',
          rateMicroPerKm: 651000,
          fuelType: 'diesel',
        };
        previews.set(previewId, { ...body, origin: b.origin, destination: b.destination });
        return route.fulfill({ json: body });
      }

      if (method === 'POST' && path === '/rides') {
        const fail = fake.failNext.publish;
        if (fail) {
          fake.failNext.publish = undefined;
          return err(route, fail[0], fail[1]);
        }
        const b = req.postDataJSON() as {
          previewId: string;
          departureAt: string;
          seats: number;
          note?: string;
          isFree: boolean;
          autoAccept?: boolean;
        };
        fake.published.push(b);
        const p = previews.get(b.previewId);
        if (!p) return err(route, 400, 'PREVIEW_EXPIRED');
        const lead = new Date(b.departureAt).getTime() - fake.now();
        if (lead < 15 * 60_000) return err(route, 400, 'DEPARTURE_TOO_SOON');
        if (lead > 14 * 86_400_000) return err(route, 400, 'DEPARTURE_TOO_FAR');
        if (b.seats > 3) return err(route, 400, 'SEATS_EXCEED_VEHICLE');
        const origin = p.origin as { lat: number; lng: number };
        const destination = p.destination as { lat: number; lng: number };
        const ride: FakeRide = {
          id: `10000000-0000-4000-8000-${String(fake.rides.length + 1).padStart(12, '0')}`,
          status: 'published',
          departureAt: b.departureAt,
          origin: { point: origin, label: p.originLabel },
          destination: { point: destination, label: p.destinationLabel },
          route: p.route,
          distanceM: p.distanceM,
          durationS: p.durationS,
          seatsOffered: b.seats,
          seatsBooked: 0,
          note: b.note ?? null,
          isFree: b.isFree,
          priceTable: b.isFree
            ? (p.priceTable as Array<{ passengers: number }>).map((r) => ({ ...r, priceBani: 0 }))
            : p.priceTable,
          tripCostBani: p.tripCostBani,
          fuelType: 'diesel',
          car: { make: 'Dacia', model: 'Logan', colour: 'Grey', plate: 'SB12ABC' },
          requests: [],
          passengers: [],
          canCancel: true,
          canEdit: true,
          autoAccept: b.autoAccept ?? false,
          lateCancelIfNow: lead <= 30 * 60_000,
          lateCancel: false,
          cancelledAt: null,
          createdAt: new Date(fake.now()).toISOString(),
        };
        fake.rides.push(ride);
        return route.fulfill({ status: 201, json: ride });
      }

      if (method === 'GET' && path === '/me/rides') {
        const scope = url.searchParams.get('scope') ?? 'upcoming';
        // Contract: past holds everything except cancelled rides; cancelled has its own scope.
        const inScope = (r: FakeRide) =>
          scope === 'cancelled'
            ? r.status === 'cancelled'
            : scope === 'past'
              ? r.status !== 'published' && r.status !== 'cancelled'
              : r.status === 'published';
        const items = fake.rides.filter(inScope).map((r) => ({
          id: r.id,
          departureAt: r.departureAt,
          originLabel: (r.origin as { label: string }).label,
          destinationLabel: (r.destination as { label: string }).label,
          status: r.status,
          seatsOffered: r.seatsOffered,
          seatsBooked: r.seatsBooked,
          pendingRequests: 0,
          cancelledAt: r.status === 'cancelled' ? (r.cancelledAt ?? null) : null,
          cancelledBy: r.status === 'cancelled' ? 'driver' : null,
        }));
        return route.fulfill({ json: { items, nextCursor: null } });
      }

      const mine = /^\/me\/rides\/([^/]+)$/.exec(path);
      if (method === 'GET' && mine) {
        const r = fake.rides.find((x) => x.id === mine[1]);
        return r ? route.fulfill({ json: r }) : err(route, 404, 'NOT_FOUND');
      }

      const edit = /^\/rides\/([^/]+)$/.exec(path);
      if (method === 'PATCH' && edit) {
        const fail = fake.failNext.edit;
        if (fail) {
          fake.failNext.edit = undefined;
          return err(route, fail[0], fail[1]);
        }
        const r = fake.rides.find((x) => x.id === edit[1]);
        if (!r) return err(route, 404, 'NOT_FOUND');
        if (r.status !== 'published') return err(route, 409, 'RIDE_NOT_EDITABLE');
        const b = req.postDataJSON() as {
          departureAt?: string;
          seats?: number;
          note?: string | null;
          autoAccept?: boolean;
        };
        fake.edits.push(b);
        if (b.departureAt) {
          const lead = new Date(b.departureAt).getTime() - fake.now();
          if (lead < 15 * 60_000) return err(route, 400, 'DEPARTURE_TOO_SOON');
          if (lead > 14 * 86_400_000) return err(route, 400, 'DEPARTURE_TOO_FAR');
          r.departureAt = b.departureAt;
        }
        if (b.seats !== undefined) {
          if (b.seats < (r.seatsBooked as number))
            return err(route, 409, 'SEATS_BELOW_BOOKED', { seats: 'below_booked' });
          r.seatsOffered = b.seats;
        }
        if (b.note !== undefined) r.note = b.note === null || b.note === '' ? null : b.note;
        if (b.autoAccept !== undefined) r.autoAccept = b.autoAccept;
        return route.fulfill({ json: r });
      }

      const cancel = /^\/rides\/([^/]+)\/cancel$/.exec(path);
      if (method === 'POST' && cancel) {
        const fail = fake.failNext.cancel;
        if (fail) {
          fake.failNext.cancel = undefined;
          return err(route, fail[0], fail[1]);
        }
        const r = fake.rides.find((x) => x.id === cancel[1]);
        if (!r) return err(route, 404, 'NOT_FOUND');
        if (r.status !== 'published') return err(route, 409, 'INVALID_STATE');
        r.status = 'cancelled';
        r.canCancel = false;
        r.cancelledAt = new Date(fake.now()).toISOString();
        return route.fulfill({ json: r });
      }
      return route.fulfill({
        status: 404,
        json: { error: { code: 'NOT_FOUND', message: 'x', requestId: 'r' } },
      });
    },
  );
}
