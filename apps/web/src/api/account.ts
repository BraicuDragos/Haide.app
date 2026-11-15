import { apiRequest } from './client';
import type { FuelType, LegalCurrent, Me, PublicUser, Vehicle } from './types';

/** Account endpoints (api-contract section 3). One file per resource (conventions section 1). */
export const getLegal = (signal?: AbortSignal) =>
  apiRequest<LegalCurrent>('/legal/current', { signal });

export const getMe = (signal?: AbortSignal) => apiRequest<Me>('/me', { signal });

export const postConsents = (body: { age18: true; termsVersion: string; privacyVersion: string }) =>
  apiRequest<void>('/me/consents', { method: 'POST', body });

export const patchProfile = (body: { firstName?: string; phone?: string; bio?: string }) =>
  apiRequest<Me>('/me/profile', { method: 'PATCH', body });

export function putPhoto(photo: Blob): Promise<{ photoUrl: string }> {
  const body = new FormData();
  body.append('photo', photo, 'photo.jpg');
  return apiRequest('/me/photo', { method: 'PUT', body, timeoutMs: 30_000 });
}

export const getVehicle = (signal?: AbortSignal) => apiRequest<Vehicle>('/me/vehicle', { signal });

export type VehicleInput = {
  make: string;
  model: string;
  colour: string;
  plate: string;
  fuelType: FuelType;
  seats: number;
};
export const putVehicle = (body: VehicleInput) =>
  apiRequest<Vehicle>('/me/vehicle', { method: 'PUT', body });

export const getUser = (id: string, signal?: AbortSignal) =>
  apiRequest<PublicUser>(`/users/${encodeURIComponent(id)}`, { signal });
