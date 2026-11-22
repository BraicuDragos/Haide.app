import AxeBuilder from '@axe-core/playwright';
import { expect, type Page, type Route } from '@playwright/test';

/** 1x1 PNG, enough to exercise the client-side resize (canvas re-encode to JPEG). */
export const PNG_1X1 = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);
const AVATAR_DATA_URL = `data:image/png;base64,${PNG_1X1.toString('base64')}`;

export async function expectNoAxeViolations(page: Page) {
  // Let entrance animations (sheets, toasts) end first: axe reads the blended colour mid-fade and
  // reports a false 4.43:1. Looping animations (glow, spinners) are skipped, they never finish.
  await page.evaluate(() =>
    Promise.all(
      document
        .getAnimations()
        .filter((a) => Number.isFinite(a.effect?.getComputedTiming().endTime ?? Infinity))
        .map((a) => a.finished.catch(() => undefined)),
    ),
  );
  const results = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
    .analyze();
  const summary = JSON.stringify(
    results.violations.map((v) => [v.id, v.nodes.map((n) => n.target)]),
    null,
    1,
  );
  expect(results.violations, summary).toEqual([]);
}

const b64url = (o: unknown) => Buffer.from(JSON.stringify(o)).toString('base64url');

/**
 * Seeds a Supabase session (auth-js storage key `haide.auth`, see apps/web/src/auth/client.ts) before the page loads.
 * The token is never validated by the browser app (the API is mocked), it only has to look unexpired.
 */
export async function seedSession(page: Page, email = 'ioana@example.com') {
  const exp = Math.floor(Date.now() / 1000) + 3600 * 24;
  const accessToken = `${b64url({ alg: 'HS256', typ: 'JWT' })}.${b64url({
    sub: 'u-1',
    email,
    role: 'authenticated',
    exp,
  })}.sig`;
  const session = {
    access_token: accessToken,
    refresh_token: 'refresh-token',
    token_type: 'bearer',
    expires_in: 3600 * 24,
    expires_at: exp,
    user: {
      id: 'u-1',
      aud: 'authenticated',
      role: 'authenticated',
      email,
      app_metadata: {},
      user_metadata: {},
      created_at: '2026-11-15T10:00:00Z',
    },
  };
  await page.addInitScript((s) => {
    try {
      // Once per tab: a later sign-out must stay signed out across full page loads.
      if (sessionStorage.getItem('e2e.seeded')) return;
      sessionStorage.setItem('e2e.seeded', '1');
      localStorage.setItem('haide.auth', JSON.stringify(s));
    } catch {
      /* ignore */
    }
  }, session);
}

/** Seeds the return-to-intent (sessionStorage) once, before the first load only. */
export async function seedIntent(page: Page, intent: { kind: string; returnTo: string }) {
  await page.addInitScript((i) => {
    try {
      if (!sessionStorage.getItem('haide.intent'))
        sessionStorage.setItem('haide.intent', JSON.stringify(i));
    } catch {
      /* ignore */
    }
  }, intent);
}

export interface FakeAccount {
  me: {
    id: string;
    email: string;
    firstName: string | null;
    phoneE164: string | null;
    bio: string | null;
    photoUrl: string | null;
    status: string;
    role: string;
    consent: { upToDate: boolean; required: string[] };
    profileComplete: boolean;
    hasVehicle: boolean;
    createdAt: string;
  };
  vehicle: Record<string, unknown> | null;
  /** Last multipart upload seen by PUT /me/photo (for assertions). */
  upload: { contentType: string; bytes: Buffer } | null;
}

export function newAccount(over: Partial<FakeAccount['me']> = {}): FakeAccount {
  return {
    me: {
      id: 'u-1',
      email: 'ioana@example.com',
      firstName: null,
      phoneE164: null,
      bio: null,
      photoUrl: null,
      status: 'active',
      role: 'user',
      consent: { upToDate: false, required: ['terms', 'privacy'] },
      profileComplete: false,
      hasVehicle: false,
      createdAt: '2026-11-15T10:00:00Z',
      ...over,
    },
    vehicle: null,
    upload: null,
  };
}

const err = (route: Route, status: number, code: string, fields?: Record<string, string>) =>
  route.fulfill({
    status,
    json: { error: { code, message: code, requestId: 'r', ...(fields ? { fields } : {}) } },
  });

/**
 * Stateful fake of the account endpoints (api-contract section 3). Mirrors the server rules the UI depends on:
 * consent must be sent, the profile is complete with name + Romanian mobile + photo, one car per user.
 */
export async function mockAccountApi(page: Page, acc: FakeAccount) {
  await page.route('**/telemetry/error', (r) => r.fulfill({ status: 204 }));
  await page.route('**/auth/v1/logout*', (r) => r.fulfill({ status: 204 }));
  await page.route('**/legal/current', (r) =>
    r.fulfill({
      json: {
        terms: { version: '1.0', url: '/policy/terms' },
        privacy: { version: '1.0', url: '/policy/privacy' },
      },
    }),
  );
  await page.route('**/api/v1/me', (r) => r.fulfill({ json: acc.me }));
  await page.route('**/me/consents', (r) => {
    const b = r.request().postDataJSON() as { age18?: boolean };
    if (b.age18 !== true) return err(r, 400, 'VALIDATION_FAILED');
    acc.me.consent = { upToDate: true, required: [] };
    return r.fulfill({ status: 204 });
  });
  await page.route('**/me/profile', (r) => {
    if (!acc.me.consent.upToDate) return err(r, 403, 'CONSENT_REQUIRED');
    const b = r.request().postDataJSON() as { firstName?: string; phone?: string; bio?: string };
    const digits = (b.phone ?? '').replace(/\s/g, '');
    const m = /^(?:\+40|0)(7\d{8})$/.exec(digits);
    if (!m) return err(r, 400, 'VALIDATION_FAILED', { phone: 'invalid' });
    acc.me.firstName = b.firstName ?? null;
    acc.me.phoneE164 = `+40${m[1]}`;
    acc.me.bio = b.bio || null;
    acc.me.profileComplete = Boolean(acc.me.firstName && acc.me.photoUrl);
    return r.fulfill({ json: acc.me });
  });
  await page.route('**/me/photo', (r) => {
    const req = r.request();
    acc.upload = {
      contentType: req.headers()['content-type'] ?? '',
      bytes: req.postDataBuffer() ?? Buffer.alloc(0),
    };
    acc.me.photoUrl = AVATAR_DATA_URL;
    acc.me.profileComplete = Boolean(acc.me.firstName && acc.me.phoneE164);
    return r.fulfill({ json: { photoUrl: acc.me.photoUrl } });
  });
  await page.route('**/me/vehicle', (r) => {
    const req = r.request();
    if (req.method() === 'PUT') {
      acc.vehicle = req.postDataJSON() as Record<string, unknown>;
      acc.me.hasVehicle = true;
      return r.fulfill({ json: acc.vehicle });
    }
    return acc.vehicle ? r.fulfill({ json: acc.vehicle }) : err(r, 404, 'NOT_FOUND');
  });
}

export function publicUser(over: Record<string, unknown> = {}) {
  return {
    id: 'u-2',
    firstName: 'Radu',
    photoUrl: null,
    memberSince: '2026-09',
    rating: null,
    ridesCompleted: 0,
    lateCancellations90d: 0,
    noShows90d: 0,
    bio: null,
    ...over,
  };
}
