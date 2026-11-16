import type { PriceRow } from '@/api/types';
import { t, tp } from '@/i18n';
import { formatRon } from '@/lib/format';

/**
 * Price per passenger by number of passengers (copy.md detail.priceTable.*). Real table with a visible caption, so
 * assistive tech reads rows and columns. `highlight` marks the row the driver is looking at (the chosen seat count).
 */
export function PriceTable({
  rows,
  caption,
  free = false,
  highlight,
}: {
  rows: PriceRow[];
  caption: string;
  free?: boolean;
  highlight?: number;
}) {
  return (
    <table className="w-full border-collapse text-md">
      <caption className="pb-2 text-left text-sm leading-5 text-text-muted">{caption}</caption>
      <thead className="sr-only">
        <tr>
          <th scope="col">{t('detail.priceTable.col1')}</th>
          <th scope="col">{t('detail.priceTable.col2')}</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => (
          <tr
            key={r.passengers}
            className={`border-t border-(color:--hair) ${r.passengers === highlight ? 'bg-tint text-on-tint' : ''}`}
          >
            <th scope="row" className="min-h-11 px-3 py-3 text-left font-normal">
              {tp('detail.priceTable.n', r.passengers)}
            </th>
            <td className="px-3 py-3 text-right font-semibold tabular-nums">
              {free ? t('common.free') : formatRon(r.priceBani)}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
