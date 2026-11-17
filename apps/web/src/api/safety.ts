import { apiRequest } from './client';
import type {
  BlockedUser,
  BookingView,
  OwnerRide,
  RatingGiven,
  RatingTag,
  ReportReason,
  SharedTrip,
} from './types';

/** Trust and safety endpoints (e5-trust-safety-spec section 6). Ids only: no place or coordinate ever leaves in a URL. */
const bk = (id: string) => `/bookings/${encodeURIComponent(id)}`;

export const postRating = (bookingId: string, body: { stars: number; tags: RatingTag[] }) =>
  apiRequest<RatingGiven>(`${bk(bookingId)}/ratings`, { method: 'POST', body });

/** A driver caller gets the owner ride back, a passenger caller the booking. */
export const postNoShow = <T extends OwnerRide | BookingView>(bookingId: string) =>
  apiRequest<T>(`${bk(bookingId)}/no-show`, { method: 'POST', body: {} });

export const postShareLink = (bookingId: string) =>
  apiRequest<{ url: string; expiresAt: string }>(`${bk(bookingId)}/share-link`, {
    method: 'POST',
    body: {},
  });

export const deleteShareLink = (bookingId: string) =>
  apiRequest<void>(`${bk(bookingId)}/share-link`, { method: 'DELETE' });

/** Public, no account: the token is the only credential, so the session token is never sent. */
export const getSharedTrip = (token: string, signal?: AbortSignal) =>
  apiRequest<SharedTrip>(`/share/${encodeURIComponent(token)}`, { signal, anonymous: true });

export const postReport = (body: {
  reportedUserId: string;
  reason: ReportReason;
  details?: string;
  rideId?: string;
  bookingId?: string;
  alsoBlock?: boolean;
}) => apiRequest<{ id: string }>('/reports', { method: 'POST', body });

export const postBlock = (userId: string) =>
  apiRequest<void>('/blocks', { method: 'POST', body: { userId } });

export const deleteBlock = (userId: string) =>
  apiRequest<void>(`/blocks/${encodeURIComponent(userId)}`, { method: 'DELETE' });

export const getMyBlocks = (signal?: AbortSignal) =>
  apiRequest<{ items: BlockedUser[] }>('/me/blocks', { signal });
