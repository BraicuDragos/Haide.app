import { describe, expect, it } from 'vitest';
import { errorEnvelopeSchema } from '../../supabase/functions/_shared/contracts/errors.ts';
import {
  placesResponseSchema,
  reverseResponseSchema,
} from '../../supabase/functions/_shared/contracts/geo.ts';
import { healthResponseSchema } from '../../supabase/functions/_shared/contracts/system.ts';

/**
 * Black-box tests against the running local stack:
 *   supabase start && supabase db reset && pnpm fn:serve   (separate terminal)
 *   API_BASE_URL=http://127.0.0.1:54321/functions/v1/api/v1 pnpm test:int
 * Skipped when API_BASE_URL is not set, so `pnpm test` never needs the stack.
 */
const BASE = process.env.API_BASE_URL;

describe.skipIf(!BASE)('API against the local stack', () => {
  const get = (path: string) => fetch(`${BASE}${path}`);
  const post = (path: string, body: unknown, headers: Record<string, string> = {}) =>
    fetch(`${BASE}${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...headers },
      body: JSON.stringify(body),
    });

  it('GET /health is 200 with db ok', async () => {
    const res = await get('/health');
    expect(res.status).toBe(200);
    expect(healthResponseSchema.parse(await res.json())).toMatchObject({ status: 'ok', db: 'ok' });
  });

  it('GET /places?q=selimbar returns Șelimbăr first', async () => {
    const res = await get('/places?q=selimbar');
    expect(res.status).toBe(200);
    const { items } = placesResponseSchema.parse(await res.json());
    expect(items[0]?.name).toBe('Șelimbăr');
  });

  it('GET /places?q=piata mare returns Piața Mare first', async () => {
    const res = await get(`/places?q=${encodeURIComponent('piata mare')}`);
    const { items } = placesResponseSchema.parse(await res.json());
    expect(items[0]?.name).toBe('Piața Mare');
  });

  it('GET /places rejects a missing query with the error envelope', async () => {
    const res = await get('/places');
    expect(res.status).toBe(400);
    expect(errorEnvelopeSchema.parse(await res.json()).error.code).toBe('VALIDATION_FAILED');
  });

  it('POST /places/reverse finds a place near Piața Mare and refuses far-away points', async () => {
    const ok = await post('/places/reverse', { point: { lat: 45.7977, lng: 24.1505 } });
    expect(ok.status).toBe(200);
    expect(reverseResponseSchema.parse(await ok.json()).place.name).toBeTruthy();
    const far = await post('/places/reverse', { point: { lat: 44.43, lng: 26.1 } });
    expect(far.status).toBe(404);
  });

  it('POST /telemetry/error answers 204', async () => {
    const res = await post('/telemetry/error', { message: 'integration test', route: '/find' });
    expect(res.status).toBe(204);
  });

  it('POST /internal/tick hides behind the cron secret', async () => {
    const res = await post('/internal/tick', {});
    expect(res.status).toBe(404);
    if (process.env.CRON_SECRET) {
      const ok = await post('/internal/tick', {}, { 'x-cron-secret': process.env.CRON_SECRET });
      expect(ok.status).toBe(200);
    }
  });

  it('unknown routes answer with a NOT_FOUND envelope', async () => {
    const res = await get('/nope');
    expect(res.status).toBe(404);
    expect(errorEnvelopeSchema.parse(await res.json()).error.code).toBe('NOT_FOUND');
  });
});
