import {
  ADMIN_NOTE_MAX,
  SUSPEND_STATEMENT_MAX,
  SUSPEND_STATEMENT_MIN,
  type AdminErrorsResponse,
  type AdminNoteBody,
  type AdminOpsResponse,
  type AdminReportsResponse,
  type AdminUsersResponse,
  type SuspendBody,
} from '../../_shared/contracts/admin.ts';
import type { Db } from '../../_shared/db.ts';
import {
  accountReinstatedOutbox,
  accountSuspendedOutbox,
  statementHasContactDetails,
} from '../../_shared/domain/privacy.ts';
import { PURGE_OVERDUE_DAYS, RELIABILITY_WINDOW_DAYS } from '../../_shared/domain/rules.ts';
import { utcMidnight } from '../../_shared/notify/dispatch.ts';
import { AppError } from '../../_shared/errors.ts';
import {
  dismissReport as dismissReportRow,
  selectAdminHistory,
  selectAdminUsers,
  selectCronRuns,
  selectOps,
  selectOpenReportCounts,
  selectRecentErrors,
  selectReports,
  selectReportState,
  selectSuspended,
  suspendUser as suspendUserRow,
  unsuspendUser as unsuspendUserRow,
  type AdminUserRow,
} from '../repo/admin.ts';
import { insertOutboxRows } from '../repo/outbox.ts';
import { lockProfile } from '../repo/privacy.ts';
import { toAdminUserRef, toErrorItems, toReportItem } from '../serializers/admin.ts';
import type { Account, Deps } from '../types.ts';
import { tx } from './bookings.ts';

/**
 * Admin actions and reads (E7-3, E5-5, e7-metrics-admin-spec §5, §6). Every write is one transaction:
 * the target's profile row is locked `for no key update` (the E6 lock-mode lesson), the state is
 * re-checked under the lock, the audited SQL function does the change and its `admin_actions` row,
 * and the outbox row is queued in the same commit. Nobody is emailed about a dismissal.
 */

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const CURSOR_TEXT_RE = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}(\.\d{1,6})?[+-]\d{2}(:?\d{2})?$/;
const DAY_MS = 86_400_000;
const HISTORY_PER_USER = 5;
const SUSPENDED_MAX = 100;

const notFound = (what: string) => new AppError('NOT_FOUND', `${what} not found.`);

/** An id that is not a UUID is simply unknown (404), never a validation error. */
function asId(id: string, what: string): string {
  if (!UUID_RE.test(id)) throw notFound(what);
  return id.toLowerCase();
}

/** NFC, trimmed; empty is `null`; more than 200 code points is `400 fields.note`. */
export function normalizeNote(raw: string | undefined): string | null {
  const text = (raw ?? '').normalize('NFC').trim();
  if (text === '') return null;
  if ([...text].length > ADMIN_NOTE_MAX) {
    throw new AppError('VALIDATION_FAILED', 'The note is too long.', {
      fields: { note: 'too_long' },
    });
  }
  return text;
}

/**
 * The statement of reasons the user receives: NFC, trimmed, 10..300 code points, and no contact
 * details (a phone, an email or a plate would leak through the outbox payload guard).
 */
export function normalizeStatement(raw: string): string {
  const text = raw.normalize('NFC').trim();
  const length = [...text].length;
  const fail = (code: string) =>
    new AppError('VALIDATION_FAILED', 'Check the statement.', { fields: { statement: code } });
  if (length === 0) throw fail('required');
  if (length < SUSPEND_STATEMENT_MIN) throw fail('too_short');
  if (length > SUSPEND_STATEMENT_MAX) throw fail('too_long');
  if (statementHasContactDetails(text)) throw fail('contact_details');
  return text;
}

async function usersById(
  deps: Deps,
  db: Db,
  ids: readonly string[],
): Promise<Map<string, AdminUserRow>> {
  const out = new Map<string, AdminUserRow>();
  const unique = [...new Set(ids)];
  if (unique.length === 0) return out;
  const since = new Date(deps.clock.now().getTime() - RELIABILITY_WINDOW_DAYS * DAY_MS);
  for (const row of await selectAdminUsers(db, unique, since)) out.set(row.id, row);
  return out;
}

// ---- GET /admin/reports ------------------------------------------------------------------------------------

export function encodeReportCursor(createdAtText: string, id: string): string {
  return btoa(`${createdAtText}|${id}`).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function decodeReportCursor(raw: string): { createdAtText: string; id: string } {
  const invalid = () =>
    new AppError('VALIDATION_FAILED', 'Invalid cursor.', { fields: { cursor: 'invalid' } });
  let decoded: string;
  try {
    decoded = atob(raw.replace(/-/g, '+').replace(/_/g, '/'));
  } catch {
    throw invalid();
  }
  const cut = decoded.lastIndexOf('|');
  const createdAtText = decoded.slice(0, cut);
  const id = decoded.slice(cut + 1);
  if (cut < 0 || !CURSOR_TEXT_RE.test(createdAtText) || !UUID_RE.test(id)) throw invalid();
  return { createdAtText, id: id.toLowerCase() };
}

export async function listReports(
  deps: Deps,
  q: { status: 'open' | 'dismissed' | 'actioned' | 'all'; limit: number; cursor?: string },
): Promise<AdminReportsResponse> {
  const after = q.cursor ? decodeReportCursor(q.cursor) : null;
  const rows = await selectReports(deps.sql, { status: q.status, limit: q.limit + 1, after });
  const page = rows.slice(0, q.limit);
  const last = page[page.length - 1];
  const nextCursor =
    rows.length > q.limit && last ? encodeReportCursor(last.created_at_text, last.id) : null;

  const people = page.flatMap((r) => [r.reporter_id, r.reported_id]);
  const reportedIds = [...new Set(page.map((r) => r.reported_id))];
  const users = await usersById(deps, deps.sql, people);
  const openCounts = await selectOpenReportCounts(deps.sql, reportedIds);
  const history = await selectAdminHistory(deps.sql, reportedIds, HISTORY_PER_USER);

  return {
    items: page.flatMap((r) => {
      const item = toReportItem(r, users, openCounts, history, deps.env);
      return item ? [item] : [];
    }),
    nextCursor,
  };
}

// ---- POST /admin/reports/{id}/dismiss ------------------------------------------------------------------------

export async function dismissReport(
  deps: Deps,
  admin: Account,
  rawId: string,
  body: AdminNoteBody,
): Promise<void> {
  const reportId = asId(rawId, 'Report');
  const note = normalizeNote(body.note);
  await tx(deps, async (db) => {
    const report = await selectReportState(db, reportId);
    if (!report) throw notFound('Report');
    if (report.status !== 'open') {
      throw new AppError('INVALID_STATE', 'This report is already resolved.');
    }
    // The function updates only an `open` report: false means another admin resolved it first.
    if (!(await dismissReportRow(db, reportId, admin.id, note))) {
      throw new AppError('INVALID_STATE', 'This report is already resolved.');
    }
  });
}

// ---- POST /admin/users/{id}/suspend ----------------------------------------------------------------------------

export async function suspendUser(
  deps: Deps,
  admin: Account,
  rawId: string,
  body: SuspendBody,
): Promise<void> {
  const userId = asId(rawId, 'User');
  if (userId === admin.id) {
    throw new AppError('VALIDATION_FAILED', 'You cannot suspend yourself.', {
      fields: { userId: 'self' },
    });
  }
  const statement = normalizeStatement(body.statement);
  const reportId = body.reportId ? body.reportId.toLowerCase() : null;

  await tx(deps, async (db) => {
    // Two parallel suspends queue here; the second sees `suspended` and gets 409.
    const profile = await lockProfile(db, userId);
    if (!profile) throw notFound('User');
    if (profile.status !== 'active') {
      throw new AppError('INVALID_STATE', 'This account is not active.');
    }
    if (reportId) {
      const report = await selectReportState(db, reportId);
      if (!report) throw notFound('Report');
      if (report.reported_id !== userId) {
        throw new AppError('VALIDATION_FAILED', 'This report is about someone else.', {
          fields: { reportId: 'mismatch' },
        });
      }
      if (report.status !== 'open') {
        throw new AppError('INVALID_STATE', 'This report is already resolved.');
      }
    }
    const done = await suspendUserRow(db, {
      userId,
      statement,
      adminId: admin.id,
      reportId,
      reasonCode: body.reasonCode,
    });
    if (!done) throw new AppError('INVALID_STATE', 'This account is not active.');
    await insertOutboxRows(db, [
      accountSuspendedOutbox(userId, { reasonCode: body.reasonCode, statement }),
    ]);
  });
}

// ---- POST /admin/users/{id}/unsuspend ---------------------------------------------------------------------------

export async function unsuspendUser(
  deps: Deps,
  admin: Account,
  rawId: string,
  body: AdminNoteBody,
): Promise<void> {
  const userId = asId(rawId, 'User');
  const note = normalizeNote(body.note);
  await tx(deps, async (db) => {
    const profile = await lockProfile(db, userId);
    if (!profile) throw notFound('User');
    if (profile.status !== 'suspended') {
      throw new AppError('INVALID_STATE', 'This account is not suspended.');
    }
    if (!(await unsuspendUserRow(db, userId, admin.id, note))) {
      throw new AppError('INVALID_STATE', 'This account is not suspended.');
    }
    await insertOutboxRows(db, [accountReinstatedOutbox(userId)]);
  });
}

// ---- GET /admin/users?status=suspended ----------------------------------------------------------------------------

export async function listSuspended(deps: Deps): Promise<AdminUsersResponse> {
  const rows = await selectSuspended(deps.sql, SUSPENDED_MAX);
  const users = await usersById(
    deps,
    deps.sql,
    rows.map((r) => r.id),
  );
  return {
    items: rows.flatMap((r) => {
      const user = users.get(r.id);
      if (!user) return [];
      return [
        {
          user: toAdminUserRef(user, deps.env),
          suspendedAt: new Date(r.suspended_at).toISOString(),
          reasonCode: (r.reason_code ?? null) as AdminUsersResponse['items'][number]['reasonCode'],
          statement: r.statement,
          adminFirstName: r.admin_first_name,
        },
      ];
    }),
  };
}

// ---- GET /admin/ops and /admin/errors --------------------------------------------------------------------------------

export async function getOps(deps: Deps): Promise<AdminOpsResponse> {
  const now = deps.clock.now();
  const row = await selectOps(
    deps.sql,
    utcMidnight(now),
    new Date(now.getTime() - DAY_MS),
    new Date(now.getTime() - PURGE_OVERDUE_DAYS * DAY_MS),
  );
  let cron: AdminOpsResponse['cron'] = [];
  try {
    cron = (await selectCronRuns(deps.sql)).map((c) => ({
      job: c.job,
      status: c.status,
      startedAt: new Date(c.started_at).toISOString(),
    }));
  } catch {
    // The ops page must work where pg_cron is not readable.
    deps.log('warn', 'admin_cron_runs_failed', {});
  }
  return {
    dbSizeMb: Math.round(Number(row.db_size_mb) * 10) / 10,
    emailsToday: row.emails_today,
    emailCap: deps.env.EMAIL_DAILY_CAP,
    outboxPending: row.outbox_pending,
    outboxFailed24h: row.outbox_failed_24h,
    routePreviewsToday: row.route_previews_today,
    errors24h: row.errors_24h,
    openReports: row.open_reports,
    openDataRequests: row.open_data_requests,
    overdueDeletions: row.overdue_deletions,
    cron,
  };
}

export async function listErrors(deps: Deps, limit: number): Promise<AdminErrorsResponse> {
  return { items: toErrorItems(await selectRecentErrors(deps.sql, limit)) };
}
