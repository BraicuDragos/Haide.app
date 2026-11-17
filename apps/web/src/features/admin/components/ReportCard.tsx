import { useState } from 'react';
import { Link } from 'react-router';
import type { AdminReport, UserStatus } from '@/api/admin';
import { t, type MessageKey } from '@/i18n';
import { Icon } from '@/ui/Icon';
import { memberMonth, reasonLabel, shortDate, shortDateTime } from '../format';
import type { AdminAction } from './AdminActionSheet';

const STATUS_TEXT: Record<UserStatus, MessageKey> = {
  active: 'admin.userStatus.active',
  suspended: 'admin.userStatus.suspended',
  deleted: 'admin.userStatus.deleted',
};
const STATUS_TONE: Record<UserStatus, string> = {
  active: 'bg-success-bg text-success',
  suspended: 'bg-error-bg text-error',
  deleted: 'bg-surface-subtle text-text-muted',
};
const REPORT_TEXT: Record<AdminReport['status'], MessageKey> = {
  open: 'admin.reports.status.open',
  dismissed: 'admin.reports.status.dismissed',
  actioned: 'admin.reports.status.actioned',
};

export function UserStatusChip({ status }: { status: UserStatus }) {
  return (
    <span
      className={`inline-flex min-h-6 items-center rounded-full px-2.5 text-sm leading-5 font-semibold ${STATUS_TONE[status]}`}
    >
      {t(STATUS_TEXT[status])}
    </span>
  );
}

const nameOf = (u: { firstName: string | null }) => u.firstName ?? t('admin.deletedUser');

/** One report: who reported whom and why, the ride, what happened already, and the actions that still make sense. */
export function ReportCard({
  report: r,
  onAction,
}: {
  report: AdminReport;
  onAction: (a: AdminAction) => void;
}) {
  const [more, setMore] = useState(false);
  const long = (r.details?.length ?? 0) > 140;
  const reported = r.reported;
  return (
    <article
      className="card flex min-w-0 flex-col gap-3 p-4"
      aria-label={t('admin.reports.cardLabel', {
        name: nameOf(reported),
        reason: reasonLabel(r.reason),
      })}
    >
      <header className="flex flex-wrap items-center justify-between gap-2">
        {/* h2 not h3: the page has an h1 and no other heading above the cards (heading-order) */}
        <h2 className="type-h3">{reasonLabel(r.reason)}</h2>
        <span className="text-sm leading-5 text-text-muted">{shortDateTime(r.createdAt)}</span>
      </header>

      <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-sm leading-5">
        <dt className="text-text-muted">{t('admin.reports.reported')}</dt>
        <dd className="flex min-w-0 flex-wrap items-center gap-2">
          <span className="font-semibold">{nameOf(reported)}</span>
          <UserStatusChip status={reported.status} />
          <span className="text-text-muted">
            {t('admin.reports.counts', { open: reported.openReports, d90: reported.reports90d })}
          </span>
        </dd>
        <dt className="text-text-muted">{t('admin.reports.reporter')}</dt>
        <dd className="min-w-0">
          {nameOf(r.reporter)}
          <span className="text-text-muted">
            {' '}
            {t('admin.reports.since', { date: memberMonth(r.reporter.memberSince) })}
          </span>
        </dd>
        {r.ride && (
          <>
            <dt className="text-text-muted">{t('admin.reports.ride')}</dt>
            <dd className="min-w-0">
              <Link
                to={`/ride/${r.ride.id}`}
                className="inline-flex min-h-11 items-center underline"
              >
                {r.ride.fromArea ?? t('admin.noValue')} to {r.ride.toArea ?? t('admin.noValue')},{' '}
                {shortDateTime(r.ride.departureAt)}
              </Link>
            </dd>
          </>
        )}
      </dl>

      {r.details && (
        <div className="flex flex-col gap-1">
          <p className={`text-sm leading-5 ${more || !long ? '' : 'line-clamp-3'}`}>{r.details}</p>
          {long && (
            <button
              type="button"
              aria-expanded={more}
              onClick={() => setMore((v) => !v)}
              className="inline-flex min-h-11 items-center gap-1 self-start font-semibold text-link"
            >
              {more ? t('admin.reports.less') : t('admin.reports.more')}
              <Icon name={more ? 'down' : 'chev'} small />
            </button>
          )}
        </div>
      )}

      {r.history.length > 0 && (
        <ul className="flex list-none flex-col gap-1 border-t border-border pt-3 text-sm leading-5 text-text-muted">
          {r.history.map((h, i) => (
            <li key={`${h.at}-${i}`}>
              {t('admin.reports.historyLine', {
                action: t(
                  `admin.action.${h.action}` in ACTIONS
                    ? (`admin.action.${h.action}` as MessageKey)
                    : 'admin.action.other',
                ),
                who: h.adminFirstName ?? t('admin.deletedUser'),
                date: shortDate(h.at),
              })}
              {h.note ? `: ${h.note}` : ''}
            </li>
          ))}
        </ul>
      )}

      <footer className="flex flex-wrap items-center gap-2 pt-1">
        <span className="mr-auto text-sm leading-5 font-semibold text-text-muted">
          {t(REPORT_TEXT[r.status])}
        </span>
        {r.status === 'open' && (
          <button
            type="button"
            className="btn btn-secondary"
            onClick={() => onAction({ kind: 'dismiss', report: r })}
          >
            {t('admin.action.dismissBtn')}
          </button>
        )}
        {reported.status === 'active' && (
          <button
            type="button"
            className="btn btn-danger"
            onClick={() =>
              onAction({
                kind: 'suspend',
                user: { id: reported.id, firstName: reported.firstName },
                ...(r.status === 'open' ? { report: r } : {}),
              })
            }
          >
            {t('admin.action.suspendBtn')}
          </button>
        )}
        {reported.status === 'suspended' && (
          <button
            type="button"
            className="btn btn-secondary"
            onClick={() =>
              onAction({
                kind: 'unsuspend',
                user: { id: reported.id, firstName: reported.firstName },
              })
            }
          >
            {t('admin.action.unsuspendBtn')}
          </button>
        )}
      </footer>
    </article>
  );
}

const ACTIONS = {
  'admin.action.suspend': 1,
  'admin.action.unsuspend': 1,
  'admin.action.dismiss_report': 1,
  'admin.action.energy_price_added': 1,
} as const;
