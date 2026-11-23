import { apiRequest } from './client';
import type {
  EditRideRequest,
  OwnerRide,
  PublishRideRequest,
  RideListResponse,
  RoutePreview,
  RoutePreviewRequest,
} from './types';

/** Ride endpoints (api-contract section 4). Locations go in POST bodies only. */
export const postRidePreview = (body: RoutePreviewRequest, signal?: AbortSignal) =>
  apiRequest<RoutePreview>('/rides/preview', { method: 'POST', body, signal, timeoutMs: 15_000 });

export const postRide = (body: PublishRideRequest) =>
  apiRequest<OwnerRide>('/rides', { method: 'POST', body });

export const getMyRides = (
  scope: 'upcoming' | 'past' | 'cancelled',
  cursor: string | undefined,
  signal?: AbortSignal,
) => apiRequest<RideListResponse>('/me/rides', { query: { scope, limit: 20, cursor }, signal });

export const getMyRide = (id: string, signal?: AbortSignal) =>
  apiRequest<OwnerRide>(`/me/rides/${encodeURIComponent(id)}`, { signal });

/** Edit a published ride (ADR 0041). Send only the fields that changed; `note: null` clears the note. */
export const patchRide = (id: string, body: EditRideRequest) =>
  apiRequest<OwnerRide>(`/rides/${encodeURIComponent(id)}`, { method: 'PATCH', body });

export const postRideCancel = (id: string) =>
  apiRequest<OwnerRide>(`/rides/${encodeURIComponent(id)}/cancel`, { method: 'POST', body: {} });
