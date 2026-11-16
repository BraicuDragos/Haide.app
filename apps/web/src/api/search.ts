import { apiRequest } from './client';
import type { LatLng, MatchResponse, PublicRide, SearchRequest, SearchResponse } from './types';

/** Search and ride detail endpoints (api-contract sections 2). Public: a signed-in token is used when present. */
export const postSearch = (body: SearchRequest, signal?: AbortSignal) =>
  apiRequest<SearchResponse>('/search', { method: 'POST', body, signal, timeoutMs: 15_000 });

export const getPublicRide = (id: string, signal?: AbortSignal) =>
  apiRequest<PublicRide>(`/rides/${encodeURIComponent(id)}`, { signal });

/** The passenger's places go in the body, never the URL. */
export const postMatch = (id: string, body: { from: LatLng; to: LatLng }, signal?: AbortSignal) =>
  apiRequest<MatchResponse>(`/rides/${encodeURIComponent(id)}/match`, {
    method: 'POST',
    body,
    signal,
  });
