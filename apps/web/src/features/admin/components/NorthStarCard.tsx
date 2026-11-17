import type { MetricsResponse } from '@/api/admin';
import { t } from '@/i18n';
import { formatMetric } from '../format';
import { StatusChip, targetText } from './MetricTile';
import { Sparkline } from './Sparkline';

/** The one big number: completed shared seats this week, with its 12-week line. Everything else on the page is quieter. */
export function NorthStarCard({ data }: { data: MetricsResponse }) {
  const m = data.northStar;
  return (
    <section aria-labelledby="north-star" className="card flex flex-col gap-4 p-5">
      <h2 id="north-star" className="type-h3">
        {t('admin.metrics.northStar')}
      </h2>
      <div className="flex flex-wrap items-end gap-x-5 gap-y-2">
        <p className="type-numeral tabular-nums">{formatMetric('count', m.value)}</p>
        <div className="pb-2">
          <StatusChip status={m.status} />
        </div>
      </div>
      <p className="text-sm leading-5 text-text-muted">{targetText('count', m, false)}</p>
      <Sparkline points={data.series} />
    </section>
  );
}
