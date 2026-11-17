import { t } from '@/i18n';
import { shortWeek } from '../isoWeek';

const W = 240;
const H = 56;
const PAD = 6;

/**
 * 12-week trend as an inline SVG line (no chart library). Decorative: the same numbers are one click away in the
 * "Show as table" details below it, which is the accessible version.
 */
export function Sparkline({ points }: { points: Array<{ week: string; completedSeats: number }> }) {
  if (points.length === 0) return null;
  const max = Math.max(1, ...points.map((p) => p.completedSeats));
  const step = points.length > 1 ? (W - PAD * 2) / (points.length - 1) : 0;
  const xy = points.map((p, i) => {
    const x = PAD + i * step;
    const y = H - PAD - (p.completedSeats / max) * (H - PAD * 2);
    return [x, y] as const;
  });
  const line = xy.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(' ');
  const last = xy[xy.length - 1]!;
  return (
    <div className="flex flex-col gap-2">
      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="h-14 w-full max-w-md text-outline"
        aria-hidden="true"
        focusable="false"
        preserveAspectRatio="none"
      >
        <polyline
          points={line}
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          vectorEffect="non-scaling-stroke"
        />
        <circle cx={last[0]} cy={last[1]} r="3.5" className="fill-accent" />
      </svg>
      <details className="text-sm leading-5">
        <summary className="inline-flex min-h-11 cursor-pointer items-center font-semibold text-link">
          {t('admin.metrics.showTable')}
        </summary>
        <table className="mt-2 w-full max-w-sm border-collapse text-left">
          <caption className="sr-only">{t('admin.metrics.seriesCaption')}</caption>
          <thead>
            <tr>
              <th scope="col" className="py-1 pr-4 font-semibold">
                {t('admin.metrics.week')}
              </th>
              <th scope="col" className="py-1 text-right font-semibold">
                {t('admin.metrics.seats')}
              </th>
            </tr>
          </thead>
          <tbody>
            {points.map((p) => (
              <tr key={p.week} className="border-t border-border">
                <th scope="row" className="py-1 pr-4 font-normal text-text-muted">
                  {shortWeek(p.week)}
                </th>
                <td className="py-1 text-right tabular-nums">{p.completedSeats}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </details>
    </div>
  );
}
