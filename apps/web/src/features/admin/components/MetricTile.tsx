import type { ReactNode } from 'react';
import type { Metric, MetricStatus } from '@/api/admin';
import { t, type MessageKey } from '@/i18n';
import { Icon, type IconName } from '@/ui/Icon';
import { formatMetric, type MetricKind } from '../format';

const STATUS: Record<MetricStatus, { icon: IconName; tone: string; label: MessageKey }> = {
  on_target: { icon: 'check', tone: 'bg-success-bg text-success', label: 'admin.status.onTarget' },
  between: { icon: 'info', tone: 'bg-warning-bg text-warning', label: 'admin.status.between' },
  below_kill: { icon: 'alert', tone: 'bg-error-bg text-error', label: 'admin.status.belowKill' },
  no_data: {
    icon: 'clock',
    tone: 'bg-surface-subtle text-text-muted',
    label: 'admin.status.noData',
  },
};

/** Icon plus words, never colour alone (accessibility.md). */
export function StatusChip({ status }: { status: MetricStatus }) {
  const s = STATUS[status];
  return (
    <span
      className={`inline-flex min-h-7 items-center gap-1 rounded-full px-3 text-sm leading-5 font-semibold ${s.tone}`}
    >
      <Icon name={s.icon} small />
      {t(s.label)}
    </span>
  );
}

/** "Target 30 %, kill below 15 %" in the right direction for the metric. */
export function targetText(
  kind: MetricKind,
  m: Pick<Metric, 'target' | 'kill'>,
  lowerIsBetter: boolean,
) {
  const target = formatMetric(kind, m.target);
  const kill = formatMetric(kind, m.kill);
  return lowerIsBetter
    ? t('admin.target.lower', { target, kill })
    : t('admin.target.higher', { target, kill });
}

interface Props {
  name: string;
  metric: Metric;
  kind: MetricKind;
  /** True when a smaller value is the good direction (response time, reports, cancellations). */
  lowerIsBetter?: boolean;
  /** What `n` counts, as text: "searches", "rides"... */
  nLabel: string;
  /** Overrides the headline value (retention shows a provisional note, match rate the launch value). */
  value?: number | null;
  children?: ReactNode;
}

/** One of the seven metric tiles: the value is the loudest thing, then the status, then the targets. */
export function MetricTile({ name, metric, kind, lowerIsBetter, nLabel, value, children }: Props) {
  const v = value === undefined ? metric.value : value;
  return (
    <article className="card flex min-w-0 flex-1 flex-col gap-3 p-4" aria-label={name}>
      <h3 className="type-h3">{name}</h3>
      <p className="type-numeral-sm tabular-nums">{formatMetric(kind, v)}</p>
      <div>
        <StatusChip status={metric.status} />
      </div>
      <p className="text-sm leading-5 text-text-muted">
        {targetText(kind, metric, lowerIsBetter === true)}
      </p>
      <p className="text-sm leading-5 text-text-muted">
        {t('admin.n', { n: metric.n, what: nLabel })}
      </p>
      {children}
    </article>
  );
}
