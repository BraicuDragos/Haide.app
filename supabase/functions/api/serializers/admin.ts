import type {
  AdminErrorsResponse,
  AdminReportItem,
  AdminUserRef,
  EnergyPrice,
} from '../../_shared/contracts/admin.ts';
import { memberSince } from '../../_shared/domain/account.ts';
import type { Env } from '../../_shared/env.ts';
import type { AdminUserRow, ErrorRow, HistoryRow, ReportRow } from '../repo/admin.ts';
import type { EnergyPriceRow } from '../repo/energyPrices.ts';
import { avatarUrl } from '../services/storage.ts';

/**
 * Admin response shapes (E7, e7-metrics-admin-spec §6). Built from explicit column lists, never by
 * spreading a row: no phone, plate, email or coordinate can be added by accident (data-model §5.2).
 */

const iso = (v: Date | string): string => new Date(v).toISOString();

/**
 * A person as an admin sees them. A deleted user has no name or photo; for the reported side of a
 * report the name at report time (the snapshot's `firstName`) stands in.
 */
export function toAdminUserRef(
  row: AdminUserRow,
  env: Env,
  fallbackFirstName: string | null = null,
): AdminUserRef {
  const deleted = row.status === 'deleted';
  return {
    id: row.id,
    firstName: deleted ? fallbackFirstName : row.first_name,
    photoUrl: deleted ? null : avatarUrl(env, row.photo_path),
    status: row.status,
    memberSince: memberSince(new Date(row.created_at)),
    ridesCompleted: Number(row.rides_completed ?? 0),
    reports90d: Number(row.reports_90d ?? 0),
  };
}

export function toHistoryItem(h: HistoryRow): AdminReportItem['history'][number] {
  const action = h.action as AdminReportItem['history'][number]['action'];
  return {
    action,
    adminFirstName: h.admin_first_name,
    at: iso(h.created_at),
    note: h.note,
  };
}

export function toReportItem(
  r: ReportRow,
  users: Map<string, AdminUserRow>,
  openReports: Map<string, number>,
  history: HistoryRow[],
  env: Env,
): AdminReportItem | null {
  const reporter = users.get(r.reporter_id);
  const reported = users.get(r.reported_id);
  if (!reporter || !reported) return null;
  return {
    id: r.id,
    status: r.status,
    reason: r.reason as AdminReportItem['reason'],
    details: r.details,
    createdAt: iso(r.created_at),
    resolvedAt: r.resolved_at ? iso(r.resolved_at) : null,
    reporter: toAdminUserRef(reporter, env),
    reported: {
      ...toAdminUserRef(reported, env, r.snapshot_first_name),
      openReports: openReports.get(r.reported_id) ?? 0,
    },
    ride:
      r.ride_id && r.ride_departure_at
        ? {
            id: r.ride_id,
            departureAt: iso(r.ride_departure_at),
            fromArea: r.ride_from_area,
            toArea: r.ride_to_area,
          }
        : null,
    bookingId: r.booking_id,
    history: history.filter((h) => h.target_user_id === r.reported_id).map(toHistoryItem),
  };
}

export function toEnergyPrice(r: EnergyPriceRow): EnergyPrice {
  return {
    id: r.id,
    fuelType: r.fuel_type,
    priceMilli: r.price_milli,
    consumptionCenti: r.consumption_centi,
    unit: r.unit,
    effectiveFrom: iso(r.effective_from),
    sourceNote: r.source_note,
    createdBy: r.created_by ? { id: r.created_by, firstName: r.created_by_first_name } : null,
    createdAt: iso(r.created_at),
  };
}

export function toErrorItems(rows: ErrorRow[]): AdminErrorsResponse['items'] {
  return rows.map((e) => ({
    id: Number(e.id),
    source: e.source,
    message: e.message,
    route: e.route,
    appVersion: e.app_version,
    createdAt: iso(e.created_at),
  }));
}
