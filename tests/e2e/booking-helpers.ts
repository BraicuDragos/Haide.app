import type { Page, Route } from '@playwright/test';
import { publicUser } from './accounts-helpers';
import { DRIVER, RIDE_ID, tomorrowAt } from './search-helpers';

/** E4 fixtures and a stateful fake of the booking endpoints (api-contract section 5). The API is always mocked. */
export const BOOKING_ID = '7c2e9f10-6a1d-4c58-9b3e-2f4a8d5c6e01';
export const OWNER_RIDE_ID = '3b9d6e20-1f4a-4b7c-8e5d-9a0c1b2d3e02';
export const REQUEST_A = '11111111-aaaa-4aaa-8aaa-000000000001';
export const REQUEST_B = '22222222-bbbb-4bbb-8bbb-000000000002';

const approx = (lat: number, lng: number) => ({ lat, lng, approx: true, radiusM: 300 });

export const PICKUP = { lat: 45.75951, lng: 24.21283 };
export const DROPOFF = { lat: 45.79264, lng: 24.09731 };

const ROUTE = {
  type: 'LineString',
  coordinates: [
    [24.21283, 45.75951],
    [24.15, 45.78],
    [24.09731, 45.79264],
  ],
};

type Json = Record<string, unknown>;

/** A BookingView as the server sends it. Defaults: a confirmed booking with exact points, contact and plate. */
export function bookingView(over: Json = {}): Json {
  return {
    id: BOOKING_ID,
    status: 'confirmed',
    rideId: RIDE_ID,
    rideStatus: 'published',
    viewerRole: 'passenger',
    departureAt: tomorrowAt(7, 25),
    pickupEtaAt: tomorrowAt(7, 30),
    requestedAt: new Date(Date.now() - 600_000).toISOString(),
    expiresAt: new Date(Date.now() + 1_200_000).toISOString(),
    decidedAt: new Date(Date.now() - 300_000).toISOString(),
    cancelledAt: null,
    cancelledBy: null,
    pickup: { point: PICKUP, label: 'Șelimbăr, Shopping City area', walkM: 150 },
    dropoff: { point: DROPOFF, label: 'Zona Industrială Vest', walkM: 100 },
    segmentM: 9588,
    route: ROUTE,
    price: { quotedBani: 310, lockedBani: 260, finalBani: null, droppedFromBani: 310 },
    driver: DRIVER,
    passenger: publicUser({ id: 'u-1', firstName: 'Ioana' }),
    car: { make: 'Dacia', model: 'Logan', colour: 'Grey', plate: 'SB12ABC' },
    contact: { phoneE164: '+40722334455', revealedUntil: tomorrowAt(7, 25) },
    timeline: [
      { status: 'requested', at: new Date(Date.now() - 600_000).toISOString() },
      { status: 'confirmed', at: new Date(Date.now() - 300_000).toISOString() },
    ],
    unseen: false,
    actions: {
      canCancel: true,
      lateCancelIfNow: false,
      canReportDriverNoShow: false,
      canRate: false,
      canShare: false,
      show112: false,
    },
    ...over,
  };
}

/** A request that has not been answered: approximate points, no contact, no plate, "up to" price. */
export function requestedView(over: Json = {}): Json {
  return bookingView({
    status: 'requested',
    decidedAt: null,
    pickup: { point: approx(45.7595, 24.2128), label: 'Șelimbăr, Shopping City area', walkM: 150 },
    dropoff: { point: approx(45.7926, 24.0973), label: 'Zona Industrială Vest', walkM: 100 },
    price: { quotedBani: 310, lockedBani: null, finalBani: null, droppedFromBani: null },
    car: { make: 'Dacia', model: 'Logan', colour: 'Grey', plate: null },
    contact: null,
    timeline: [{ status: 'requested', at: new Date(Date.now() - 60_000).toISOString() }],
    ...over,
  });
}

export function listItem(over: Json = {}): Json {
  return {
    id: BOOKING_ID,
    rideId: RIDE_ID,
    status: 'requested',
    rideStatus: 'published',
    departureAt: tomorrowAt(7, 25),
    pickupEtaAt: tomorrowAt(7, 30),
    pickupLabel: 'Șelimbăr, Shopping City area',
    dropoffLabel: 'Zona Industrială Vest',
    driver: DRIVER,
    priceBani: 310,
    unseen: false,
    cancelledBy: null,
    cancelledAt: null,
    ...over,
  };
}

const passenger = (id: string, name: string) => publicUser({ id, firstName: name });

export function ownerRide(over: Json = {}): Json {
  return {
    id: OWNER_RIDE_ID,
    status: 'published',
    departureAt: tomorrowAt(7, 25),
    origin: { point: PICKUP, label: 'Șelimbăr, Shopping City' },
    destination: { point: DROPOFF, label: 'Zona Industrială Vest' },
    route: ROUTE,
    distanceM: 9588,
    durationS: 1020,
    seatsOffered: 3,
    seatsBooked: 0,
    note: null,
    isFree: false,
    priceTable: [
      { passengers: 1, priceBani: 310 },
      { passengers: 2, priceBani: 200 },
      { passengers: 3, priceBani: 150 },
    ],
    tripCostBani: 624,
    fuelType: 'diesel',
    car: { make: 'Dacia', model: 'Logan', colour: 'Grey', plate: 'SB12ABC' },
    requests: [
      {
        bookingId: REQUEST_A,
        passenger: passenger('u-a', 'Mihai'),
        pickupLabel: 'Șelimbăr, Shopping City area',
        dropoffLabel: 'Zona Industrială Vest',
        segmentM: 9588,
        priceIfAcceptedBani: 310,
        requestedAt: new Date(Date.now() - 300_000).toISOString(),
        expiresAt: new Date(Date.now() + 1_500_000).toISOString(),
      },
      {
        bookingId: REQUEST_B,
        passenger: passenger('u-b', 'Elena'),
        pickupLabel: 'Șelimbăr, Shopping City area',
        dropoffLabel: 'Zona Industrială Vest',
        segmentM: 5390,
        priceIfAcceptedBani: 170,
        requestedAt: new Date(Date.now() - 120_000).toISOString(),
        expiresAt: new Date(Date.now() + 1_700_000).toISOString(),
      },
    ],
    passengers: [],
    canCancel: true,
    lateCancelIfNow: false,
    lateCancel: false,
    cancelledAt: null,
    createdAt: new Date(Date.now() - 86_400_000).toISOString(),
    ...over,
  };
}

export interface FakeBookings {
  /** The booking GET /bookings/{id} answers with (null: 404). */
  booking: Json | null;
  upcoming: Json[];
  past: Json[];
  /** GET /me/bookings?scope=cancelled. */
  cancelled: Json[];
  summary: { driverPendingRequests: number; passengerUnseenUpdates: number; nextRide: unknown };
  /** What POST /bookings received: body and the Idempotency-Key header. */
  created: Array<{ body: Json; key: string | undefined }>;
  /** Ids sent to POST /me/summary/seen. */
  seen: string[][];
  cancels: number;
  /** One-shot failures. A string code answers with 409 (400 for VALIDATION_FAILED); 'ABORT' drops the connection. */
  failNextCreate?: string;
  failNextCancel?: string;
  failNextApprove?: string;
  /** The driver's ride (GET /me/rides/{OWNER_RIDE_ID}). */
  owner: Json;
  approved: string[];
  rejected: string[];
}

export function newFakeBookings(): FakeBookings {
  return {
    booking: null,
    upcoming: [],
    past: [],
    cancelled: [],
    summary: { driverPendingRequests: 0, passengerUnseenUpdates: 0, nextRide: null },
    created: [],
    seen: [],
    cancels: 0,
    owner: ownerRide(),
    approved: [],
    rejected: [],
  };
}

const err = (route: Route, status: number, code: string) =>
  route.fulfill({ status, json: { error: { code, message: code, requestId: 'r' } } });
const statusOf = (code: string) => (code === 'VALIDATION_FAILED' ? 400 : 409);

/** Mocks POST /bookings, GET /bookings/{id}, cancel, approve, reject, /me/bookings, /me/summary(/seen), /me/rides/{id}. */
export async function mockBookingsApi(page: Page, fake: FakeBookings) {
  await page.route(
    (url) => /\/api\/v1\/(bookings|me\/bookings|me\/summary|me\/rides\/)/.test(url.pathname),
    async (route) => {
      const req = route.request();
      const url = new URL(req.url());
      const path = url.pathname.replace(/^.*\/api\/v1/, '');
      const method = req.method();
      if (method === 'OPTIONS') return route.fulfill({ status: 204 });

      if (method === 'POST' && path === '/bookings') {
        const fail = fake.failNextCreate;
        if (fail) {
          fake.failNextCreate = undefined;
          // Record the attempt either way: a dropped connection is exactly when the key matters.
          fake.created.push({
            body: req.postDataJSON() as Json,
            key: req.headers()['idempotency-key'],
          });
          if (fail === 'ABORT') return route.abort('connectionreset');
          return err(route, statusOf(fail), fail);
        }
        fake.created.push({
          body: req.postDataJSON() as Json,
          key: req.headers()['idempotency-key'],
        });
        fake.booking = requestedView();
        return route.fulfill({ status: 201, json: fake.booking });
      }

      if (method === 'GET' && path === '/me/bookings') {
        const scope = url.searchParams.get('scope') ?? 'upcoming';
        return route.fulfill({
          json: {
            items:
              scope === 'past' ? fake.past : scope === 'cancelled' ? fake.cancelled : fake.upcoming,
            nextCursor: null,
          },
        });
      }

      if (method === 'GET' && path === '/me/summary') return route.fulfill({ json: fake.summary });
      if (method === 'POST' && path === '/me/summary/seen') {
        fake.seen.push((req.postDataJSON() as { bookingIds: string[] }).bookingIds);
        return route.fulfill({ status: 204 });
      }

      const one = /^\/bookings\/([^/]+)$/.exec(path);
      if (method === 'GET' && one) {
        if (!fake.booking || fake.booking.id !== one[1]) return err(route, 404, 'NOT_FOUND');
        return route.fulfill({ json: fake.booking });
      }

      const act = /^\/bookings\/([^/]+)\/(cancel|approve|reject)$/.exec(path);
      if (method === 'POST' && act) {
        const [, id, action] = act as unknown as [string, string, string];
        if (action === 'cancel') {
          fake.cancels += 1;
          const fail = fake.failNextCancel;
          if (fail) {
            fake.failNextCancel = undefined;
            return err(route, 409, fail);
          }
          fake.booking = {
            ...(fake.booking ?? bookingView()),
            status: 'cancelled',
            cancelledBy: 'passenger',
            cancelledAt: new Date().toISOString(),
            contact: null,
            actions: { ...(bookingView().actions as Json), canCancel: false },
            timeline: [
              ...((fake.booking?.timeline as Json[] | undefined) ?? []),
              { status: 'cancelled', at: new Date().toISOString() },
            ],
          };
          return route.fulfill({ json: fake.booking });
        }
        // Driver actions answer with the updated owner ride.
        const requests = fake.owner.requests as Json[];
        const req0 = requests.find((r) => r.bookingId === id);
        if (action === 'approve') {
          const fail = fake.failNextApprove;
          if (fail) {
            fake.failNextApprove = undefined;
            return err(route, 409, fail);
          }
          fake.approved.push(id);
          if (req0) {
            fake.owner = {
              ...fake.owner,
              seatsBooked: (fake.owner.seatsBooked as number) + 1,
              requests: requests.filter((r) => r.bookingId !== id),
              passengers: [
                ...(fake.owner.passengers as Json[]),
                {
                  bookingId: id,
                  status: 'confirmed',
                  passenger: req0.passenger,
                  pickup: { point: PICKUP, label: req0.pickupLabel },
                  dropoff: { point: DROPOFF, label: req0.dropoffLabel },
                  phoneE164: '+40721234567',
                  priceLockedBani: req0.priceIfAcceptedBani,
                  finalPriceBani: null,
                  canMarkNoShow: false,
                  canRate: false,
                },
              ],
            };
          }
        } else {
          fake.rejected.push(id);
          fake.owner = { ...fake.owner, requests: requests.filter((r) => r.bookingId !== id) };
        }
        return route.fulfill({ json: fake.owner });
      }

      const mine = /^\/me\/rides\/([^/]+)$/.exec(path);
      if (method === 'GET' && mine && mine[1] === OWNER_RIDE_ID)
        return route.fulfill({ json: fake.owner });

      return route.fallback();
    },
  );
}
