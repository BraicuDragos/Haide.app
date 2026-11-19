import type { Db } from '../../_shared/db.ts';

/**
 * SQL for the admin area (E7, e7-metrics-admin-spec §5, §6): the reports queue, the suspended list,
 * the audit reads and the ops tiles. postgres.js tagged templates only, columns listed explicitly.
 * Nothing here selects a phone number, plate, email or coordinate: ride endpoints are area NAMES.
 * Writes go through the audited SQL functions (admin_dismiss_report, admin_suspend_user,
 * admin_unsuspend_user); ids are lower-cased uuids and arrive from the service already validated.
 */

type Ts = Date | string;

// ---- people --------------------------------------------------------------------------------------------

export type AdminUserRow = {
  id: string;
  first_name: string | null;
  photo_path: string | null;
  status: 'active' | 'suspended' | 'deleted';
  created_at: Ts;
  rides_completed: number;
  reports_90d: number;
};

/** One round trip for any number of users. `ids` must not be empty. */
export async function selectAdminUsers(
  sql: Db,
  ids: readonly string[],
  reportsSince: Date,
): Promise<AdminUserRow[]> {
  return await sql<AdminUserRow[]>`
    select p.id, p.first_name, p.photo_path, p.status, p.created_at,
      ((select count(*)::int from app.bookings b where b.passenger_id = p.id and b.status = 'completed')
       + (select count(*)::int from app.rides x where x.driver_id = p.id and x.status = 'completed')) as rides_completed,
      (select count(*)::int from app.reports r
        where r.reported_id = p.id and r.created_at > ${reportsSince}) as reports_90d
    from app.profiles p
    where p.id in ${sql([...ids])}`;
}

/** Open reports per reported user. */
export async function selectOpenReportCounts(
  sql: Db,
  userIds: readonly string[],
): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  if (userIds.length === 0) return out;
  const rows = await sql<{ reported_id: string; n: number }[]>`
    select reported_id, count(*)::int as n
    from app.reports
    where status = 'open' and reported_id in ${sql([...userIds])}
    group by reported_id`;
  for (const r of rows) out.set(r.reported_id, r.n);
  return out;
}

// ---- reports queue -----------------------------------------------------------------------------------------

export type ReportRow = {
  id: string;
  status: 'open' | 'dismissed' | 'actioned';
  reason: string;
  details: string | null;
  created_at: Ts;
  /** The exact text of created_at: the keyset cursor must not lose microseconds. */
  created_at_text: string;
  resolved_at: Ts | null;
  reporter_id: string;
  reported_id: string;
  ride_id: string | null;
  booking_id: string | null;
  snapshot_first_name: string | null;
  ride_departure_at: Ts | null;
  ride_from_area: string | null;
  ride_to_area: string | null;
};

export type ReportsPage = {
  status: 'open' | 'dismissed' | 'actioned' | 'all';
  limit: number;
  after: { createdAtText: string; id: string } | null;
};

/** Newest first, keyset on (created_at, id). Fetches `limit` rows; the caller asks for one more to detect a next page. */
export async function selectReports(sql: Db, p: ReportsPage): Promise<ReportRow[]> {
  return await sql<ReportRow[]>`
    select r.id, r.status, r.reason, r.details, r.created_at, r.created_at::text as created_at_text,
           r.resolved_at, r.reporter_id, r.reported_id, r.ride_id, r.booking_id,
           r.reported_snapshot ->> 'firstName' as snapshot_first_name,
           rd.departure_at as ride_departure_at, oa.name as ride_from_area, da.name as ride_to_area
    from app.reports r
    left join app.rides rd on rd.id = r.ride_id
    left join app.areas oa on oa.id = rd.origin_area_id
    left join app.areas da on da.id = rd.destination_area_id
    where (${p.status}::text = 'all' or r.status::text = ${p.status}::text)
      and (${p.after?.createdAtText ?? null}::timestamptz is null
           or (r.created_at, r.id) < (${p.after?.createdAtText ?? null}::timestamptz, ${p.after?.id ?? null}::uuid))
    order by r.created_at desc, r.id desc
    limit ${p.limit}`;
}

/** One report: its state, reported user, and the reason it carries. Undefined when unknown. */
export async function selectReportState(
  sql: Db,
  reportId: string,
): Promise<
  { id: string; status: 'open' | 'dismissed' | 'actioned'; reported_id: string } | undefined
> {
  const rows = await sql<
    { id: string; status: 'open' | 'dismissed' | 'actioned'; reported_id: string }[]
  >`select id, status, reported_id from app.reports where id = ${reportId}`;
  return rows[0];
}

export type HistoryRow = {
  target_user_id: string;
  action: string;
  admin_first_name: string | null;
  created_at: Ts;
  note: string | null;
};

/** The last `perUser` admin actions about each user, newest first. `note` is the note or, for a suspension, the statement. */
export async function selectAdminHistory(
  sql: Db,
  userIds: readonly string[],
  perUser: number,
): Promise<HistoryRow[]> {
  if (userIds.length === 0) return [];
  return await sql<HistoryRow[]>`
    select h.target_user_id, h.action, h.admin_first_name, h.created_at, h.note
    from (
      select a.target_user_id, a.action, ap.first_name as admin_first_name, a.created_at,
             coalesce(a.details ->> 'note', a.details ->> 'reason') as note,
             row_number() over (partition by a.target_user_id order by a.created_at desc, a.id desc) as rn
      from app.admin_actions a
      left join app.profiles ap on ap.id = a.admin_id
      where a.target_user_id in ${sql([...userIds])}) h
    where h.rn <= ${perUser}
    order by h.target_user_id, h.created_at desc`;
}

// ---- audited writes (one SQL function each) ------------------------------------------------------------

export async function dismissReport(
  sql: Db,
  reportId: string,
  adminId: string,
  note: string | null,
): Promise<boolean> {
  const rows = await sql<{ ok: boolean }[]>`
    select app.admin_dismiss_report(${reportId}::uuid, ${adminId}::uuid, ${note}::text) as ok`;
  return rows[0]?.ok === true;
}

export async function suspendUser(
  sql: Db,
  v: {
    userId: string;
    statement: string;
    adminId: string;
    reportId: string | null;
    reasonCode: string;
  },
): Promise<boolean> {
  const rows = await sql<{ ok: boolean }[]>`
    select app.admin_suspend_user(${v.userId}::uuid, ${v.statement}::text, ${v.adminId}::uuid,
                                  ${v.reportId}::uuid, ${v.reasonCode}::text) as ok`;
  return rows[0]?.ok === true;
}

export async function unsuspendUser(
  sql: Db,
  userId: string,
  adminId: string,
  note: string | null,
): Promise<boolean> {
  const rows = await sql<{ ok: boolean }[]>`
    select app.admin_unsuspend_user(${userId}::uuid, ${note}::text, ${adminId}::uuid) as ok`;
  return rows[0]?.ok === true;
}

// ---- GET /admin/users?status=suspended ----------------------------------------------------------------

export type SuspendedRow = {
  id: string;
  suspended_at: Ts;
  reason_code: string | null;
  statement: string | null;
  admin_first_name: string | null;
};

/** Currently suspended users with their latest suspension audit row (none for a SQL-console suspension without one). */
export async function selectSuspended(sql: Db, limit: number): Promise<SuspendedRow[]> {
  return await sql<SuspendedRow[]>`
    select p.id, coalesce(a.created_at, p.updated_at) as suspended_at,
           a.details ->> 'reasonCode' as reason_code, a.details ->> 'reason' as statement,
           ap.first_name as admin_first_name
    from app.profiles p
    left join lateral (
      select x.created_at, x.details, x.admin_id from app.admin_actions x
      where x.target_user_id = p.id and x.action = 'suspend'
      order by x.created_at desc, x.id desc limit 1) a on true
    left join app.profiles ap on ap.id = a.admin_id
    where p.status = 'suspended'
    order by coalesce(a.created_at, p.updated_at) desc, p.id
    limit ${limit}`;
}

// ---- GET /admin/ops ---------------------------------------------------------------------------------------

export type OpsRow = {
  db_size_mb: number;
  emails_today: number;
  outbox_pending: number;
  outbox_failed_24h: number;
  route_previews_today: number;
  errors_24h: number;
  open_reports: number;
  open_data_requests: number;
  overdue_deletions: number;
};

/**
 * All the ops counters in one statement. `dayStart` is UTC midnight (the email cap day), `since24h`
 * and `overdueBefore` come from the injected clock. Route previews are the sum of the `ride-preview`
 * rate-limit counters since midnight: one per openrouteservice call.
 */
export async function selectOps(
  sql: Db,
  dayStart: Date,
  since24h: Date,
  overdueBefore: Date,
): Promise<OpsRow> {
  const rows = await sql<OpsRow[]>`
    select
      (pg_database_size(current_database()) / 1048576.0)::float8 as db_size_mb,
      (select count(*)::int from app.outbox
        where channel = 'email' and status = 'sent' and sent_at >= ${dayStart}) as emails_today,
      (select count(*)::int from app.outbox where channel = 'email' and status = 'pending') as outbox_pending,
      (select count(*)::int from app.outbox
        where channel = 'email' and status = 'failed' and created_at >= ${since24h}) as outbox_failed_24h,
      (select coalesce(sum(count), 0)::int from app.rate_limits
        where key like 'ride-preview:%' and window_start >= ${dayStart}) as route_previews_today,
      (select count(*)::int from app.app_errors where created_at >= ${since24h}) as errors_24h,
      (select count(*)::int from app.reports where status = 'open') as open_reports,
      (select count(*)::int from app.data_requests where fulfilled_at is null) as open_data_requests,
      (select count(*)::int from app.account_deletions
        where completed_at is null and requested_at < ${overdueBefore}) as overdue_deletions`;
  const row = rows[0];
  if (!row) throw new Error('ops query returned no row');
  return row;
}

export async function selectCronRuns(
  sql: Db,
): Promise<{ job: string; status: string; started_at: Ts }[]> {
  return await sql<{ job: string; status: string; started_at: Ts }[]>`
    select job, status, started_at from app.admin_cron_runs()`;
}

// ---- GET /admin/errors ------------------------------------------------------------------------------------

export type ErrorRow = {
  id: string | number;
  source: 'client' | 'server';
  message: string;
  route: string | null;
  app_version: string | null;
  created_at: Ts;
};

/** Newest first. Never selects the stack or the user hash. */
export async function selectRecentErrors(sql: Db, limit: number): Promise<ErrorRow[]> {
  return await sql<ErrorRow[]>`
    select id, source, message, route, app_version, created_at
    from app.app_errors
    order by created_at desc, id desc
    limit ${limit}`;
}
