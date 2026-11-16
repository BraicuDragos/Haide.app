import type { Env } from '../../env.ts';
import { createFixtureProvider } from './fixture.ts';
import { createOrsProvider } from './ors.ts';
import type { RoutingProvider } from './types.ts';

export type { RouteResult, RoutingProvider } from './types.ts';

/** ROUTING_PROVIDER=ors needs ORS_API_KEY (env.ts refuses to boot otherwise). */
export function createRoutingProvider(
  env: Pick<Env, 'ROUTING_PROVIDER' | 'ORS_API_KEY'>,
): RoutingProvider {
  if (env.ROUTING_PROVIDER === 'ors') {
    return createOrsProvider({ apiKey: env.ORS_API_KEY ?? '' });
  }
  return createFixtureProvider();
}
