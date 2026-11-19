import { apiRequest } from './client';
import type { OwnerRide } from './types';

import type {
  AlertSchedule,
  CreateAlertBody,
  CreateSeriesBody,
  CreateSeriesResponse,
  MonthStatsResponse,
  PutPushSubscriptionBody,
  RideAlert,
  SkipCode,
} from '@contracts/liquidity';
import type { RideSeries, Weekday } from '@contracts/rides';

/** E8 liquidity endpoints (e8-liquidity-spec section 7). Types come straight from the backend contracts. */
export type { AlertSchedule, RideAlert, RideSeries, SkipCode, Weekday };
export type AlertWindow = RideAlert['windowMin'];
export type AlertInput = CreateAlertBody;
export type SeriesBody = CreateSeriesBody;
export type SeriesCreated = CreateSeriesResponse;
export type MonthStats = MonthStatsResponse;
export type PushSubscriptionJson = PutPushSubscriptionBody;

export const postSeries = (body: SeriesBody) =>
  apiRequest<SeriesCreated>('/ride-series', { method: 'POST', body, timeoutMs: 20_000 });

export const postSeriesCancel = (id: string) =>
  apiRequest<{ series: RideSeries; cancelledRideIds: string[] }>(
    `/ride-series/${encodeURIComponent(id)}/cancel`,
    { method: 'POST', body: {}, timeoutMs: 20_000 },
  );

export const patchRideAutoAccept = (id: string, autoAccept: boolean) =>
  apiRequest<OwnerRide>(`/me/rides/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    body: { autoAccept },
  });

export const postAlert = (body: AlertInput) =>
  apiRequest<{ item: RideAlert }>('/alerts', { method: 'POST', body });
export const getAlerts = (signal?: AbortSignal) =>
  apiRequest<{ items: RideAlert[] }>('/me/alerts', { signal });
export const deleteAlert = (id: string) =>
  apiRequest<void>(`/alerts/${encodeURIComponent(id)}`, { method: 'DELETE' });

export const getPushConfig = (signal?: AbortSignal) =>
  apiRequest<{ vapidPublicKey: string | null }>('/push/config', { signal, anonymous: true });
export const putPushSubscription = (body: PushSubscriptionJson) =>
  apiRequest<void>('/me/push-subscription', { method: 'PUT', body });
export const deletePushSubscription = (endpoint?: string) =>
  apiRequest<void>('/me/push-subscription', {
    method: 'DELETE',
    body: endpoint ? { endpoint } : {},
  });

export const getMonthStats = (signal?: AbortSignal) =>
  apiRequest<MonthStats>('/me/stats/month', { signal });
