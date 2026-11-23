import { apiRequest } from './client';
import type { PopularRoutesResponse } from './types';

/** GET /popular-routes (public, works signed out, cached for 5 minutes by the server). */
export const getPopularRoutes = (signal?: AbortSignal) =>
  apiRequest<PopularRoutesResponse>('/popular-routes', { signal });
