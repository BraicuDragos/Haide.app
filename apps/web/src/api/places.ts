import { apiRequest } from './client';
import type { LatLng, Place } from './types';

export async function searchPlaces(q: string, signal?: AbortSignal): Promise<Place[]> {
  const res = await apiRequest<{ items: Place[] }>('/places', { query: { q, limit: 8 }, signal });
  return res.items;
}

/** Location is sent in the POST body, never in the URL. */
export async function reversePlace(point: LatLng, signal?: AbortSignal): Promise<Place> {
  const res = await apiRequest<{ place: Place }>('/places/reverse', {
    method: 'POST',
    body: { point },
    signal,
  });
  return res.place;
}
