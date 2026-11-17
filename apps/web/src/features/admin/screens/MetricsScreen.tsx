import { useQuery } from '@tanstack/react-query';
import { useSearchParams } from 'react-router';
import { getAdminMetrics, type MetricsResponse } from '@/api/admin';
import { keys } from '@/api/keys';
import { t } from '@/i18n';
import { Notice } from '@/ui/Notice';
import { AdminView } from '../components/AdminView';
import { MetricTile } from '../components/MetricTile';
import { NorthStarCard } from '../components/NorthStarCard';
import { WeekPicker } from '../components/WeekPicker';
import { corridorLabel, formatMetric } from '../format';
import { compareWeeks, currentIsoWeek, parseIsoWeek } from '../isoWeek';

/** First week with metrics (spec 3). */
export const FIRST_WEEK = '2026-W46';

/** Screen 7.1: the seven numbers of mvp-scope 4 for one ISO week, the North Star first. */
export default function MetricsScreen() {
  const [params, setParams] = useSearchParams();
  const now = currentIsoWeek();
  const asked = params.get('week');
  const week =
    asked &&
    parseIsoWeek(asked) &&
    compareWeeks(asked, FIRST_WEEK) >= 0 &&
    compareWeeks(asked, now) <= 0
      ? asked
      : now;
  const q = useQuery({
    queryKey: keys.admin.metrics(week),
    queryFn: ({ signal }) => getAdminMetrics(week, signal),
  });
  return (
    <AdminView
      title={t('admin.metrics.title')}
      query={q}
      extra={
        <WeekPicker
          week={week}
          min={FIRST_WEEK}
          max={now}
          onChange={(w) => setParams(w === now ? {} : { week: w }, { replace: true })}
        />
      }
    >
      {(d) => <Dashboard d={d} />}
    </AdminView>
  );
}

function Dashboard({ d }: { d: MetricsResponse }) {
  const drivers = d.flags.highVolumeDrivers;
  return (
    <>
      {d.partial && <Notice tone="info">{t('admin.metrics.partial')}</Notice>}
      <NorthStarCard data={d} />
      <ul className="grid list-none grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
        <li className="flex">
          <MetricTile
            name={t('admin.metrics.matchRate')}
            metric={d.matchRate.launch}
            kind="percent"
            nLabel={t('admin.n.searches')}
          >
            <p className="text-sm leading-5 text-text-muted">
              {t('admin.metrics.matchOverall', {
                value: formatMetric('percent', d.matchRate.overall.value),
              })}
            </p>
          </MetricTile>
        </li>
        <li className="flex">
          <MetricTile
            name={t('admin.metrics.fillRate')}
            metric={d.fillRate}
            kind="percent"
            nLabel={t('admin.n.rides')}
          />
        </li>
        <li className="flex">
          <MetricTile
            name={t('admin.metrics.response')}
            metric={d.medianResponseMin}
            kind="minutes"
            lowerIsBetter
            nLabel={t('admin.n.requests')}
          />
        </li>
        <li className="flex">
          <MetricTile
            name={t('admin.metrics.retention')}
            metric={d.retention4w}
            kind="percent"
            nLabel={t('admin.n.passengers')}
          >
            <p className="text-sm leading-5 text-text-muted">
              {t('admin.metrics.cohort', { week: d.retention4w.cohortWeek })}
            </p>
            {!d.retention4w.closed && (
              <p className="text-sm leading-5 font-semibold text-warning">
                {t('admin.metrics.provisional')}
              </p>
            )}
          </MetricTile>
        </li>
        <li className="flex">
          <MetricTile
            name={t('admin.metrics.reports')}
            metric={d.reportsPer100}
            kind="per100"
            lowerIsBetter
            nLabel={t('admin.n.rides')}
          />
        </li>
        <li className="flex">
          <MetricTile
            name={t('admin.metrics.cancellation')}
            metric={d.cancellationRate}
            kind="percent"
            lowerIsBetter
            nLabel={t('admin.n.bookings')}
          />
        </li>
      </ul>

      <section aria-labelledby="corridors" className="card flex flex-col gap-3 p-4">
        <h2 id="corridors" className="type-h3">
          {t('admin.metrics.corridors')}
        </h2>
        <div
          className="overflow-x-auto"
          role="region"
          tabIndex={0}
          aria-label={t('admin.metrics.corridorsCaption')}
        >
          <table className="w-full border-collapse text-left">
            <caption className="sr-only">{t('admin.metrics.corridorsCaption')}</caption>
            <thead>
              <tr className="text-sm leading-5 text-text-muted">
                <th scope="col" className="py-2 pr-4 font-semibold">
                  {t('admin.metrics.corridor')}
                </th>
                <th scope="col" className="py-2 pr-4 text-right font-semibold">
                  {t('admin.metrics.rate')}
                </th>
                <th scope="col" className="py-2 text-right font-semibold">
                  {t('admin.metrics.searchesCol')}
                </th>
              </tr>
            </thead>
            <tbody>
              {d.matchRate.byCorridor.map((c) => (
                <tr key={c.corridor} className="border-t border-border">
                  <th scope="row" className="py-3 pr-4 font-normal">
                    {corridorLabel(c.corridor)}
                  </th>
                  <td className="py-3 pr-4 text-right tabular-nums">
                    {formatMetric('percent', c.value)}
                  </td>
                  <td className="py-3 text-right tabular-nums">{c.searches}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section aria-labelledby="flags" className="card flex flex-col gap-3 p-4">
        <h2 id="flags" className="type-h3">
          {t('admin.metrics.flags')}
        </h2>
        {drivers.length === 0 ? (
          <p className="text-text-muted">{t('admin.metrics.flagsEmpty')}</p>
        ) : (
          <ul className="flex list-none flex-col gap-2">
            {drivers.map((f) => (
              <li key={f.user.id} className="flex items-baseline justify-between gap-3">
                <span className="font-semibold">{f.user.firstName ?? t('admin.deletedUser')}</span>
                <span className="text-sm leading-5 text-text-muted">
                  {t('admin.metrics.flagLine', { n: f.completed7d })}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </>
  );
}
