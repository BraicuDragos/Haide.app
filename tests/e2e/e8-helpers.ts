import type { Page, Route } from '@playwright/test';
import { ownerRide, OWNER_RIDE_ID } from './booking-helpers';
import type { FakeRides } from './rides-helpers';

/**
 * E8 fixtures and one stateful fake for the liquidity endpoints (e8-liquidity-spec section 7): ride series, auto-accept,
 * alerts, push configuration and subscription, and the monthly stats. The API is always mocked here; the server rules
 * are covered by the backend unit, pgTAP and integration suites.
 */
type Json = Record<string, unknown>;

export const ALERT_ID = 'a1a1a1a1-0000-4000-8000-000000000001';
export const VAPID_KEY =
  'BEl62iUYgUivxIkv69yViEuiBIa-Ib9-SkvMeAtA3LFgDzkrxZJjSgSfCxNjYgJ9uXEq0uCuaH1jkG1xOcBUJxY';

export interface FakeLiquidity {
  alerts: Json[];
  alertPosts: Json[];
  alertDeletes: string[];
  /** Answer the next POST /alerts with 409 ALERT_LIMIT. */
  limitReached: boolean;
  seriesPosts: Json[];
  seriesCancels: string[];
  /** Dates the next series skips, with the reason. */
  skip: Array<{ index: number; code: string }>;
  patches: Array<{ id: string; autoAccept: boolean }>;
  failNextPatch?: [number, string];
  vapidPublicKey: string | null;
  pushPuts: Json[];
  pushDeletes: Json[];
  month: { driver: number; passenger: number };
  rides?: FakeRides;
}

export function newFakeLiquidity(over: Partial<FakeLiquidity> = {}): FakeLiquidity {
  return {
    alerts: [],
    alertPosts: [],
    alertDeletes: [],
    limitReached: false,
    seriesPosts: [],
    seriesCancels: [],
    skip: [],
    patches: [],
    vapidPublicKey: VAPID_KEY,
    pushPuts: [],
    pushDeletes: [],
    month: { driver: 0, passenger: 0 },
    ...over,
  };
}

const err = (route: Route, status: number, code: string, fields?: Json) =>
  route.fulfill({
    status,
    json: { error: { code, message: code, requestId: 'r', ...(fields ? { fields } : {}) } },
  });

/** Alerts as the API sends them: newest first, with an expiry. */
export function rideAlert(over: Json = {}): Json {
  return {
    id: ALERT_ID,
    from: { lat: 45.7595, lng: 24.2128 },
    to: { lat: 45.7926, lng: 24.0973 },
    fromLabel: 'Șelimbăr',
    toLabel: 'Zona Industrială Vest',
    schedule: { kind: 'weekly', weekdays: [1] },
    time: '07:30',
    windowMin: 30,
    createdAt: new Date().toISOString(),
    expiresAt: new Date(Date.now() + 13 * 86_400_000).toISOString(),
    lastNotifiedAt: null,
    matchesSent: 0,
    ...over,
  };
}

const iso = (d: Date) => d.toISOString().slice(0, 10);
const isoWeekday = (day: string) => {
  const w = new Date(`${day}T00:00:00Z`).getUTCDay();
  return w === 0 ? 7 : w;
};

export function seriesOwnerRide(
  id: string,
  departureAt: string,
  series: Json,
  over: Json = {},
): Json & { id: string; status: string; departureAt: string } {
  return ownerRide({
    id,
    departureAt,
    requests: [],
    autoAccept: false,
    series,
    ...over,
  }) as Json & { id: string; status: string; departureAt: string };
}

export async function mockLiquidityApi(page: Page, fake: FakeLiquidity) {
  await page.route(
    (url) =>
      /\/api\/v1\/(ride-series|alerts|me\/alerts|push\/config|me\/push-subscription|me\/stats\/month)/.test(
        url.pathname,
      ) || /\/api\/v1\/me\/rides\/[^/]+$/.test(url.pathname),
    async (route) => {
      const req = route.request();
      const path = new URL(req.url()).pathname.replace(/^.*\/api\/v1/, '');
      const method = req.method();
      if (method === 'OPTIONS') return route.fulfill({ status: 204 });

      if (method === 'GET' && path === '/push/config')
        return route.fulfill({ json: { vapidPublicKey: fake.vapidPublicKey } });
      if (method === 'PUT' && path === '/me/push-subscription') {
        fake.pushPuts.push(req.postDataJSON() as Json);
        return route.fulfill({ status: 204 });
      }
      if (method === 'DELETE' && path === '/me/push-subscription') {
        fake.pushDeletes.push((req.postDataJSON() as Json | null) ?? {});
        return route.fulfill({ status: 204 });
      }

      if (method === 'GET' && path === '/me/stats/month') {
        return route.fulfill({
          json: {
            month: '2026-11',
            from: '2026-11-01',
            to: '2026-12-01',
            driver: {
              sharedFuelCostBani: fake.month.driver,
              passengersCarried: fake.month.driver > 0 ? 4 : 0,
              ridesCompleted: fake.month.driver > 0 ? 3 : 0,
            },
            passenger: { paidBani: fake.month.passenger, ridesCompleted: 0 },
          },
        });
      }

      if (method === 'GET' && path === '/me/alerts')
        return route.fulfill({ json: { items: fake.alerts } });
      if (method === 'POST' && path === '/alerts') {
        const b = req.postDataJSON() as Json;
        fake.alertPosts.push(b);
        if (fake.limitReached) return err(route, 409, 'ALERT_LIMIT');
        const item = rideAlert({
          ...b,
          id: `a1a1a1a1-0000-4000-8000-${String(fake.alerts.length + 2).padStart(12, '0')}`,
        });
        fake.alerts = [item, ...fake.alerts];
        return route.fulfill({ status: 201, json: { item } });
      }
      const delAlert = /^\/alerts\/([^/]+)$/.exec(path);
      if (method === 'DELETE' && delAlert) {
        fake.alertDeletes.push(delAlert[1]!);
        fake.alerts = fake.alerts.filter((a) => a.id !== delAlert[1]);
        return route.fulfill({ status: 204 });
      }

      const patch = /^\/me\/rides\/([^/]+)$/.exec(path);
      if (method === 'PATCH' && patch) {
        if (fake.failNextPatch) {
          const [s, c] = fake.failNextPatch;
          fake.failNextPatch = undefined;
          return err(route, s, c);
        }
        const body = req.postDataJSON() as { autoAccept: boolean };
        fake.patches.push({ id: patch[1]!, autoAccept: body.autoAccept });
        const r = fake.rides?.rides.find((x) => x.id === patch[1]);
        if (r) r.autoAccept = body.autoAccept;
        return route.fulfill({
          json: r ?? ownerRide({ id: patch[1], autoAccept: body.autoAccept }),
        });
      }
      // Other methods on /me/rides/{id} belong to the rides fake.
      if (/^\/me\/rides\//.test(path)) return route.fallback();

      if (method === 'POST' && path === '/ride-series') {
        const b = req.postDataJSON() as {
          weekdays: number[];
          departureTime: string;
          startsOn: string;
          endsOn: string;
          autoAccept?: boolean;
        };
        fake.seriesPosts.push(b);
        const dates: string[] = [];
        for (
          let d = new Date(`${b.startsOn}T00:00:00Z`);
          iso(d) <= b.endsOn;
          d = new Date(d.getTime() + 86_400_000)
        )
          if (b.weekdays.includes(isoWeekday(iso(d)))) dates.push(iso(d));
        const skipped = fake.skip
          .filter((s) => dates[s.index])
          .map((s) => ({ date: dates[s.index]!, code: s.code }));
        const kept = dates.filter((d) => !skipped.some((s) => s.date === d));
        if (kept.length === 0) return err(route, 409, 'DAILY_RIDE_LIMIT');
        const series = {
          id: 'c0c0c0c0-0000-4000-8000-000000000001',
          weekdays: b.weekdays,
          departureTime: b.departureTime,
          startsOn: b.startsOn,
          endsOn: b.endsOn,
          status: 'active',
          upcomingCount: kept.length,
        };
        const created = kept.map((d, i) => ({
          rideId:
            i === 0
              ? OWNER_RIDE_ID
              : `10000000-0000-4000-8000-${String(100 + i).padStart(12, '0')}`,
          departureAt: new Date(`${d}T${b.departureTime}:00+02:00`).toISOString(),
        }));
        fake.rides?.rides.push(
          ...created.map((c) =>
            seriesOwnerRide(c.rideId, c.departureAt, series, { autoAccept: b.autoAccept === true }),
          ),
        );
        return route.fulfill({ status: 201, json: { series, created, skipped } });
      }

      const cancelSeries = /^\/ride-series\/([^/]+)\/cancel$/.exec(path);
      if (method === 'POST' && cancelSeries) {
        fake.seriesCancels.push(cancelSeries[1]!);
        const ids: string[] = [];
        for (const r of fake.rides?.rides ?? [])
          if (r.series && r.status === 'published') {
            r.status = 'cancelled';
            r.canCancel = false;
            ids.push(r.id);
          }
        return route.fulfill({
          json: {
            series: {
              id: cancelSeries[1],
              weekdays: [1],
              departureTime: '07:30',
              startsOn: '2026-11-23',
              endsOn: '2026-12-20',
              status: 'cancelled',
              upcomingCount: 0,
            },
            cancelledRideIds: ids,
          },
        });
      }
      return route.fallback();
    },
  );
}

/**
 * Browser push stubs: Notification (permission and request), PushManager and a service worker registration whose
 * pushManager keeps one subscription in memory. `window.__push` exposes what happened for assertions.
 */
export async function stubPush(
  page: Page,
  opts: {
    permission?: 'default' | 'granted' | 'denied';
    answer?: 'granted' | 'denied';
    /** Start with an existing subscription (a device that already opted in). */
    subscribed?: boolean;
  } = {},
) {
  await page.addInitScript(
    ({ permission, answer, subscribed }) => {
      const state = { permission, requests: 0, subscribeCalls: 0, unsubscribed: 0 };
      let current: {
        endpoint: string;
        toJSON: () => unknown;
        unsubscribe: () => Promise<boolean>;
      } | null = null;
      const make = () => ({
        endpoint: 'https://fcm.googleapis.com/fcm/send/e2e-device',
        toJSON() {
          return {
            endpoint: 'https://fcm.googleapis.com/fcm/send/e2e-device',
            keys: { p256dh: 'p'.repeat(87), auth: 'a'.repeat(22) },
            expirationTime: null,
          };
        },
        async unsubscribe() {
          state.unsubscribed += 1;
          current = null;
          return true;
        },
      });
      class FakeNotification {
        static get permission() {
          return state.permission;
        }
        static async requestPermission() {
          state.requests += 1;
          state.permission = answer;
          return answer;
        }
      }
      (window as unknown as Record<string, unknown>).Notification = FakeNotification;
      (window as unknown as Record<string, unknown>).PushManager = class {};
      if (subscribed) current = make();
      const registration = {
        pushManager: {
          getSubscription: async () => current,
          subscribe: async () => {
            state.subscribeCalls += 1;
            current = make();
            return current;
          },
        },
      };
      try {
        Object.defineProperty(navigator.serviceWorker, 'ready', {
          configurable: true,
          get: () => Promise.resolve(registration),
        });
      } catch {
        /* no service worker container: the app then reports push as unsupported */
      }
      (window as unknown as Record<string, unknown>).__push = state;
    },
    {
      permission: opts.permission ?? 'default',
      answer: opts.answer ?? 'granted',
      subscribed: opts.subscribed ?? false,
    },
  );
}
