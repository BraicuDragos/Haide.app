import { useQuery } from '@tanstack/react-query';
import { getAdminErrors, getAdminOps, type OpsResponse } from '@/api/admin';
import { keys } from '@/api/keys';
import { t, type MessageKey } from '@/i18n';
import { EmptyState } from '@/ui/EmptyState';
import { AdminView } from '../components/AdminView';
import { shortDateTime } from '../format';

const num = new Intl.NumberFormat('en-GB');

function tiles(o: OpsResponse): Array<{ label: MessageKey; value: string }> {
  return [
    { label: 'admin.ops.db', value: `${num.format(o.dbSizeMb)} MB` },
    {
      label: 'admin.ops.emails',
      value: `${num.format(o.emailsToday)} / ${num.format(o.emailCap)}`,
    },
    { label: 'admin.ops.outbox', value: num.format(o.outboxPending) },
    { label: 'admin.ops.failed', value: num.format(o.outboxFailed24h) },
    { label: 'admin.ops.previews', value: num.format(o.routePreviewsToday) },
    { label: 'admin.ops.errors', value: num.format(o.errors24h) },
    { label: 'admin.ops.reports', value: num.format(o.openReports) },
    { label: 'admin.ops.data', value: num.format(o.openDataRequests) },
    { label: 'admin.ops.deletions', value: num.format(o.overdueDeletions) },
  ];
}

/** Screen 7.5: the owner's glance at whether the free tiers and the jobs are healthy. */
export default function OpsScreen() {
  const ops = useQuery({ queryKey: keys.admin.ops, queryFn: ({ signal }) => getAdminOps(signal) });
  const errors = useQuery({
    queryKey: keys.admin.errors,
    queryFn: ({ signal }) => getAdminErrors(signal),
  });
  return (
    <AdminView title={t('admin.ops.title')} query={ops}>
      {(o) => (
        <>
          <ul className="grid list-none grid-cols-2 gap-3 md:grid-cols-3">
            {tiles(o).map((tile) => (
              <li key={tile.label} className="card flex flex-col gap-1 p-4">
                <p className="text-sm leading-5 text-text-muted">{t(tile.label)}</p>
                <p className="type-numeral-sm tabular-nums">{tile.value}</p>
              </li>
            ))}
          </ul>

          <section aria-labelledby="ops-cron" className="card flex flex-col gap-3 p-4">
            <h2 id="ops-cron" className="type-h3">
              {t('admin.ops.cron')}
            </h2>
            {o.cron.length === 0 ? (
              <p className="text-text-muted">{t('admin.ops.cronEmpty')}</p>
            ) : (
              <ul className="flex list-none flex-col gap-2">
                {o.cron.map((c) => (
                  <li
                    key={c.job}
                    className="flex flex-wrap items-baseline justify-between gap-x-4 text-sm leading-5"
                  >
                    <span className="font-semibold">{c.job}</span>
                    <span className="text-text-muted">
                      {c.status}, {shortDateTime(c.startedAt)}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section aria-labelledby="ops-errors" className="card flex flex-col gap-3 p-4">
            <h2 id="ops-errors" className="type-h3">
              {t('admin.ops.recentErrors')}
            </h2>
            {errors.isPending ? (
              <p role="status" className="text-text-muted">
                {t('admin.loading')}
              </p>
            ) : errors.isError ? (
              <p role="alert" className="text-error">
                {t('admin.ops.errorsFailed')}
              </p>
            ) : errors.data.items.length === 0 ? (
              <EmptyState
                title={t('admin.ops.noErrors.title')}
                body={t('admin.ops.noErrors.body')}
              />
            ) : (
              <ul className="flex list-none flex-col gap-3">
                {errors.data.items.map((e) => (
                  <li key={e.id} className="flex flex-col gap-0.5 text-sm leading-5">
                    <span className="font-semibold break-words">{e.message}</span>
                    <span className="text-text-muted">
                      {[e.source, e.route, e.appVersion, shortDateTime(e.createdAt)]
                        .filter(Boolean)
                        .join(', ')}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </>
      )}
    </AdminView>
  );
}
