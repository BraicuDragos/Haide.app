import { apiRequest } from './client';
import type { BookingListResponse, BookingView, LatLng, OwnerRide, SummaryResponse } from './types';

/** Booking endpoints (api-contract section 5, E4). Places go in POST bodies only. No price is ever sent. */
export const postBooking = (
  body: { rideId: string; from: LatLng; to: LatLng },
  idempotencyKey: string,
) =>
  apiRequest<BookingView>('/bookings', {
    method: 'POST',
    body,
    headers: { 'Idempotency-Key': idempotencyKey },
    timeoutMs: 15_000,
  });

export const getMyBookings = (
  scope: 'upcoming' | 'past',
  cursor: string | undefined,
  signal?: AbortSignal,
) =>
  apiRequest<BookingListResponse>('/me/bookings', {
    query: { scope, limit: 20, cursor },
    signal,
  });

export const getBooking = (id: string, signal?: AbortSignal) =>
  apiRequest<BookingView>(`/bookings/${encodeURIComponent(id)}`, { signal });

export const postBookingCancel = (id: string) =>
  apiRequest<BookingView>(`/bookings/${encodeURIComponent(id)}/cancel`, {
    method: 'POST',
    body: {},
  });

/** Driver actions return the updated owner ride. */
export const postBookingApprove = (id: string) =>
  apiRequest<OwnerRide>(`/bookings/${encodeURIComponent(id)}/approve`, {
    method: 'POST',
    body: {},
  });

export const postBookingReject = (id: string) =>
  apiRequest<OwnerRide>(`/bookings/${encodeURIComponent(id)}/reject`, {
    method: 'POST',
    body: {},
  });

export const getSummary = (signal?: AbortSignal) =>
  apiRequest<SummaryResponse>('/me/summary', { signal });

export const postSummarySeen = (bookingIds: string[]) =>
  apiRequest<void>('/me/summary/seen', { method: 'POST', body: { bookingIds } });
