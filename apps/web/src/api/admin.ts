import type {
  AdminErrorsResponse,
  AdminMetricsResponse,
  AdminOpsResponse,
  AdminReportItem,
  AdminUserRef,
  AdminUsersResponse,
  CreateEnergyPriceBody,
  CreateEnergyPriceResponse,
  EnergyPrice,
  EnergyPricesResponse,
  Metric,
  MetricStatus,
} from '@contracts/admin';
import type { ReportReason } from '@contracts/safety';
import { apiRequest } from './client';

/**
 * Admin endpoints (e7 spec section 6). Every one answers 403 FORBIDDEN to a non-admin. Types come from the shared
 * contract (type-only, no zod in the bundle). No phone, plate, email or coordinates exist in any admin response.
 */
export type {
  AdminUserRef,
  EnergyPrice,
  EnergyPricesResponse,
  Metric,
  MetricStatus,
  AdminMetricsResponse as MetricsResponse,
  AdminReportItem as AdminReport,
  AdminOpsResponse as OpsResponse,
};
export type UserStatus = AdminUserRef['status'];
export type ReportStatus = AdminReportItem['status'];
export type ReportFilter = ReportStatus | 'all';
export type SuspendedUser = AdminUsersResponse['items'][number];
export type AdminError = AdminErrorsResponse['items'][number];
export type EnergyFuel = EnergyPrice['fuelType'];
export type EnergyPriceBody = CreateEnergyPriceBody;
export interface ReportsResponse {
  items: AdminReportItem[];
  nextCursor: string | null;
}

const uid = (id: string) => encodeURIComponent(id);

export const getAdminMetrics = (week: string | undefined, signal?: AbortSignal) =>
  apiRequest<AdminMetricsResponse>('/admin/metrics', { query: { week }, signal });

export const getAdminReports = (
  status: ReportFilter,
  cursor: string | undefined,
  signal?: AbortSignal,
) => apiRequest<ReportsResponse>('/admin/reports', { query: { status, cursor }, signal });

export const dismissReport = (id: string, note?: string) =>
  apiRequest<void>(`/admin/reports/${uid(id)}/dismiss`, {
    method: 'POST',
    body: note ? { note } : {},
  });

export const suspendUser = (
  id: string,
  body: { reasonCode: ReportReason; statement: string; reportId?: string },
) => apiRequest<void>(`/admin/users/${uid(id)}/suspend`, { method: 'POST', body });

export const unsuspendUser = (id: string, note?: string) =>
  apiRequest<void>(`/admin/users/${uid(id)}/unsuspend`, {
    method: 'POST',
    body: note ? { note } : {},
  });

export const getSuspendedUsers = (signal?: AbortSignal) =>
  apiRequest<AdminUsersResponse>('/admin/users', {
    query: { status: 'suspended' },
    signal,
  });

export const getEnergyPrices = (signal?: AbortSignal) =>
  apiRequest<EnergyPricesResponse>('/admin/energy-prices', { signal });

export const postEnergyPrice = (body: EnergyPriceBody) =>
  apiRequest<CreateEnergyPriceResponse>('/admin/energy-prices', { method: 'POST', body });

export const getAdminOps = (signal?: AbortSignal) =>
  apiRequest<AdminOpsResponse>('/admin/ops', { signal });

export const getAdminErrors = (signal?: AbortSignal) =>
  apiRequest<AdminErrorsResponse>('/admin/errors', { query: { limit: 20 }, signal });
