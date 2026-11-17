import type { Page } from '@playwright/test';
import { mockAccountApi, newAccount, seedSession, type FakeAccount } from './accounts-helpers';

/** What the E6 specs record about the mocked privacy endpoints. */
export interface PrivacyCalls {
  deletes: Array<Record<string, unknown>>;
  consents: Array<Record<string, unknown>>;
  dataRequests: number;
}

export interface E6Options {
  theme?: 'dark' | 'light';
  /** Signed in (default). False: no session, only the public endpoints. */
  signedIn?: boolean;
  /** GET /me answers consent.reaccept = true until POST /me/consents. */
  reaccept?: boolean;
  /** Fixed answer of POST /me/data-export-request. */
  dataRequest?: { requestedAt: string; dueBy: string };
}

const LEGAL = {
  terms: { version: '1.1', url: '/policy/terms' },
  privacy: { version: '1.1', url: '/policy/privacy' },
};

/**
 * Mocked API for the E6 screens (e6 spec section 6): GET /me with `consent.reaccept`, DELETE /me, POST /me/consents
 * without `age18`, POST /me/data-export-request, GET /legal/current at v1.1. The server rules are covered by the
 * backend suites; these specs check what the person sees and sends at 360x800.
 */
export async function setupE6(page: Page, opts: E6Options = {}) {
  const calls: PrivacyCalls = { deletes: [], consents: [], dataRequests: 0 };
  await page.addInitScript(
    (t) => window.localStorage.setItem('haide.theme', t),
    opts.theme ?? 'dark',
  );
  await page.route('**/telemetry/error', (r) => r.fulfill({ status: 204 }));
  await page.route('**/auth/v1/logout*', (r) => r.fulfill({ status: 204 }));

  const acc: FakeAccount = newAccount({
    firstName: 'Ioana',
    phoneE164: '+40721234567',
    profileComplete: true,
    consent: { upToDate: !opts.reaccept, required: opts.reaccept ? ['terms', 'privacy'] : [] },
  });
  let reaccept = opts.reaccept === true;
  const legal = () => page.route('**/legal/current', (r) => r.fulfill({ json: LEGAL }));
  if (opts.signedIn !== false) {
    await seedSession(page);
    await mockAccountApi(page, acc);
    await legal();
    // Later routes win: the state-aware /me, consents and the E6 endpoints.
    await page.route('**/api/v1/me', (r) => {
      if (r.request().method() === 'DELETE') {
        calls.deletes.push(r.request().postDataJSON() as Record<string, unknown>);
        return r.fulfill({ status: 204 });
      }
      return r.fulfill({
        json: { ...acc.me, consent: { ...acc.me.consent, reaccept } },
      });
    });
    await page.route('**/me/consents', (r) => {
      const body = r.request().postDataJSON() as Record<string, unknown>;
      calls.consents.push(body);
      reaccept = false;
      acc.me.consent = { upToDate: true, required: [] };
      return r.fulfill({ status: 204 });
    });
    await page.route('**/me/data-export-request', (r) => {
      calls.dataRequests += 1;
      const now = new Date();
      const due = new Date(now.getTime() + 30 * 86_400_000);
      return r.fulfill({
        status: 202,
        json: {
          requestId: 'dr-1',
          requestedAt: opts.dataRequest?.requestedAt ?? now.toISOString(),
          dueBy: opts.dataRequest?.dueBy ?? due.toISOString(),
        },
      });
    });
  }
  if (opts.signedIn === false) await legal();
  return { calls, acc };
}
