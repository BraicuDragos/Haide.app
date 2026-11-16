import { z } from 'zod';
import type { LatLng } from '../../contracts/geo.ts';
import { AppError } from '../../errors.ts';
import type { RouteResult, RoutingProvider } from './types.ts';

export const ORS_BASE_URL = 'https://api.openrouteservice.org';
export const ORS_PATH = '/v2/directions/driving-car/geojson';
export const ORS_TIMEOUT_MS = 5_000;
export const ORS_USER_AGENT = 'Haide/1.0';

/** ORS error codes for "no routable point" / "route not found" (docs: error codes 2009, 2010). */
const NOT_FOUND_CODES = new Set([2009, 2010]);

const responseSchema = z.object({
  features: z
    .array(
      z.object({
        geometry: z.object({ coordinates: z.array(z.array(z.number()).min(2)).min(2) }),
        properties: z.object({
          summary: z.object({ distance: z.number(), duration: z.number() }),
        }),
      }),
    )
    .min(1),
});

export type OrsOptions = {
  apiKey: string;
  baseUrl?: string;
  timeoutMs?: number;
  /** Injected for tests. */
  fetchImpl?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
};

const unavailable = (why: string) =>
  new AppError('ROUTING_UNAVAILABLE', `Routing is unavailable (${why}).`);

/** Reads ORS's `{ error: { code } }` (or `{ error: <number> }`) without trusting the shape. */
async function errorCode(res: Response): Promise<number | null> {
  try {
    const body = (await res.json()) as { error?: unknown };
    const e = body?.error;
    if (typeof e === 'object' && e !== null && typeof (e as { code?: unknown }).code === 'number') {
      return (e as { code: number }).code;
    }
    return typeof e === 'number' ? e : null;
  } catch {
    return null;
  }
}

/**
 * openrouteservice `driving-car`. Server-side only; one call per ride preview.
 * 5 s timeout, one retry (with jitter) on network errors and 502/503/504, never on a timeout, so a
 * stuck upstream costs at most 5 s. Coordinates are sent in the POST body and never logged.
 */
export function createOrsProvider(opts: OrsOptions): RoutingProvider {
  const doFetch = opts.fetchImpl ?? fetch;
  const timeoutMs = opts.timeoutMs ?? ORS_TIMEOUT_MS;
  const url = `${(opts.baseUrl ?? ORS_BASE_URL).replace(/\/+$/, '')}${ORS_PATH}`;
  const sleep = opts.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));

  async function call(origin: LatLng, destination: LatLng): Promise<Response> {
    return await doFetch(url, {
      method: 'POST',
      headers: {
        authorization: opts.apiKey,
        'content-type': 'application/json',
        accept: 'application/geo+json, application/json',
        'user-agent': ORS_USER_AGENT,
      },
      body: JSON.stringify({
        coordinates: [
          [origin.lng, origin.lat],
          [destination.lng, destination.lat],
        ],
        instructions: false,
      }),
      signal: AbortSignal.timeout(timeoutMs),
    });
  }

  return {
    name: 'ors',
    async route(origin, destination): Promise<RouteResult> {
      let res: Response | null = null;
      for (let attempt = 0; attempt < 2 && res === null; attempt++) {
        try {
          const r = await call(origin, destination);
          if ([502, 503, 504].includes(r.status) && attempt === 0) {
            await sleep(100 + Math.floor(Math.random() * 200));
            continue;
          }
          res = r;
        } catch (err) {
          const name = (err as { name?: string }).name;
          if (name === 'TimeoutError' || name === 'AbortError') throw unavailable('timeout');
          if (attempt === 1) throw unavailable('network');
          await sleep(100 + Math.floor(Math.random() * 200));
        }
      }
      if (res === null) throw unavailable('no response');

      if (!res.ok) {
        const code = await errorCode(res);
        if (res.status === 404 || (code !== null && NOT_FOUND_CODES.has(code))) {
          throw new AppError('ROUTE_NOT_FOUND', 'No route between these points.');
        }
        throw unavailable(`status ${res.status}`);
      }

      let json: unknown;
      try {
        json = await res.json();
      } catch {
        throw unavailable('bad body');
      }
      const parsed = responseSchema.safeParse(json);
      if (!parsed.success) throw unavailable('bad shape');
      const feature = parsed.data.features[0];
      if (!feature) throw unavailable('no feature');
      return {
        distanceM: Math.round(feature.properties.summary.distance),
        durationS: Math.max(1, Math.round(feature.properties.summary.duration)),
        coordinates: feature.geometry.coordinates.map((c): [number, number] => [
          c[0] as number,
          c[1] as number,
        ]),
      };
    },
  };
}
