import { describe, expect, it } from 'vitest';
import type { AppError } from '../../errors.ts';
import { createRoutingProvider } from './index.ts';
import { ORS_USER_AGENT, createOrsProvider } from './ors.ts';

const origin = { lat: 45.7413, lng: 24.1861 };
const destination = { lat: 45.785, lng: 24.09 };

const okBody = {
  type: 'FeatureCollection',
  features: [
    {
      type: 'Feature',
      geometry: {
        type: 'LineString',
        coordinates: [
          [24.1861, 45.7413, 410],
          [24.1, 45.78, 400],
          [24.09, 45.785, 398],
        ],
      },
      properties: { summary: { distance: 9588.4, duration: 1019.6 } },
    },
  ],
};

type Call = { url: string; init: RequestInit };
const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

function setup(responses: (Response | Error)[]) {
  const calls: Call[] = [];
  const fetchImpl = ((url: string, init: RequestInit) => {
    calls.push({ url, init });
    const next = responses.shift();
    if (!next) return Promise.reject(new Error('no more responses'));
    return next instanceof Error ? Promise.reject(next) : Promise.resolve(next);
  }) as unknown as typeof fetch;
  const provider = createOrsProvider({
    apiKey: 'test-key',
    fetchImpl,
    sleep: () => Promise.resolve(),
  });
  return { provider, calls };
}

const codeOf = async (p: Promise<unknown>) => {
  try {
    await p;
  } catch (e) {
    return (e as AppError).code;
  }
  return null;
};

const route = (responses: (Response | Error)[]) =>
  setup(responses).provider.route(origin, destination);

describe('openrouteservice provider', () => {
  it('posts the coordinates (lng, lat) with the key and the Haide user agent', async () => {
    const { provider, calls } = setup([json(200, okBody)]);
    await provider.route(origin, destination);
    const call = calls[0];
    expect(call?.url).toBe('https://api.openrouteservice.org/v2/directions/driving-car/geojson');
    expect(call?.init.method).toBe('POST');
    const headers = call?.init.headers as Record<string, string>;
    expect(headers.authorization).toBe('test-key');
    expect(headers['user-agent']).toBe('Haide/1.0');
    expect(ORS_USER_AGENT).toBe('Haide/1.0');
    expect(JSON.parse(call?.init.body as string)).toEqual({
      coordinates: [
        [24.1861, 45.7413],
        [24.09, 45.785],
      ],
      instructions: false,
    });
    expect(call?.init.signal).toBeInstanceOf(AbortSignal);
  });

  it('maps the response to metres, seconds and [lng, lat] vertices (elevation dropped)', async () => {
    const r = await route([json(200, okBody)]);
    expect(r).toEqual({
      distanceM: 9588,
      durationS: 1020,
      coordinates: [
        [24.1861, 45.7413],
        [24.1, 45.78],
        [24.09, 45.785],
      ],
    });
  });

  it('answers ROUTE_NOT_FOUND for 404 and for ORS codes 2009 and 2010', async () => {
    expect(await codeOf(route([json(404, { error: { code: 2010 } })]))).toBe('ROUTE_NOT_FOUND');
    expect(await codeOf(route([json(400, { error: { code: 2010, message: 'x' } })]))).toBe(
      'ROUTE_NOT_FOUND',
    );
    expect(await codeOf(route([json(400, { error: { code: 2009 } })]))).toBe('ROUTE_NOT_FOUND');
  });

  it('answers ROUTING_UNAVAILABLE for other errors, quota, bad keys and bad bodies', async () => {
    const bad = [
      () => json(400, { error: { code: 2004 } }),
      () => json(401, { error: 'bad key' }),
      () => json(403, {}),
      () => json(429, {}),
      () => json(500, {}),
      () => json(200, { features: [] }),
      () => json(200, { nope: true }),
      () => new Response('not json', { status: 200 }),
    ];
    for (const make of bad) {
      expect(await codeOf(route([make()]))).toBe('ROUTING_UNAVAILABLE');
    }
  });

  it('retries once on a network error, then succeeds', async () => {
    const { provider, calls } = setup([new TypeError('fetch failed'), json(200, okBody)]);
    expect((await provider.route(origin, destination)).distanceM).toBe(9588);
    expect(calls).toHaveLength(2);
  });

  it('retries once on 503 and gives up after the second failure', async () => {
    const ok = setup([json(503, {}), json(200, okBody)]);
    expect((await ok.provider.route(origin, destination)).distanceM).toBe(9588);
    const bad = setup([json(503, {}), json(502, {})]);
    expect(await codeOf(bad.provider.route(origin, destination))).toBe('ROUTING_UNAVAILABLE');
    expect(bad.calls).toHaveLength(2);
    expect(await codeOf(route([new TypeError('a'), new TypeError('b')]))).toBe(
      'ROUTING_UNAVAILABLE',
    );
  });

  it('never retries a timeout', async () => {
    const timeout = Object.assign(new Error('timed out'), { name: 'TimeoutError' });
    const { provider, calls } = setup([timeout, json(200, okBody)]);
    expect(await codeOf(provider.route(origin, destination))).toBe('ROUTING_UNAVAILABLE');
    expect(calls).toHaveLength(1);
  });

  it('does not leak the key or coordinates in error messages', async () => {
    try {
      await route([json(500, {})]);
      expect.unreachable();
    } catch (e) {
      const msg = (e as Error).message;
      expect(msg).not.toContain('test-key');
      expect(msg).not.toContain('45.74');
    }
  });
});

describe('createRoutingProvider', () => {
  it('picks the fixture provider by default and ORS when configured', () => {
    const fixture = createRoutingProvider({ ROUTING_PROVIDER: 'fixture', ORS_API_KEY: undefined });
    expect(fixture.name).toBe('fixture');
    expect(createRoutingProvider({ ROUTING_PROVIDER: 'ors', ORS_API_KEY: 'k' }).name).toBe('ors');
  });
});
