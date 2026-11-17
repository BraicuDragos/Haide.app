import { useQuery } from '@tanstack/react-query';
import { getEnergyPrices, type EnergyPrice } from '@/api/admin';
import { keys } from '@/api/keys';
import { t } from '@/i18n';
import { AdminView } from '../components/AdminView';
import { EnergyPriceForm, fuelLabel } from '../components/EnergyPriceForm';
import { CENTI, formatScaled, MILLI } from '../energyChange';
import { shortDateTime } from '../format';

const price = (p: EnergyPrice) => `${formatScaled(p.priceMilli, MILLI)} RON/${p.unit}`;
const cons = (p: EnergyPrice) => `${formatScaled(p.consumptionCenti, CENTI)} ${p.unit}/100 km`;

/** Screen 7.4: the price in effect per fuel, what is scheduled, the form to add a version, and the history. */
export default function EnergyScreen() {
  const q = useQuery({
    queryKey: keys.admin.energy,
    queryFn: ({ signal }) => getEnergyPrices(signal),
  });
  return (
    <AdminView title={t('admin.energy.title')} query={q}>
      {(d) => (
        <div className="grid min-w-0 gap-5 xl:grid-cols-[minmax(0,1fr)_minmax(0,28rem)]">
          <div className="flex min-w-0 flex-col gap-5 xl:order-1">
            <ul className="grid list-none grid-cols-1 gap-3 sm:grid-cols-2">
              {d.fuels.map((f) => (
                <li key={f.fuelType} className="flex">
                  <article className="card flex min-w-0 flex-1 flex-col gap-2 p-4">
                    <h2 className="type-h3">{fuelLabel(f.fuelType)}</h2>
                    <p className="type-numeral-sm tabular-nums">{price(f.current)}</p>
                    <p className="text-sm leading-5 text-text-muted">{cons(f.current)}</p>
                    <p className="text-sm leading-5 text-text-muted">
                      {t('admin.energy.since', { date: shortDateTime(f.current.effectiveFrom) })}
                    </p>
                    {f.scheduled && (
                      <p className="rounded-md bg-info-bg px-3 py-2 text-sm leading-5 font-semibold text-info">
                        {t('admin.energy.scheduled', {
                          price: price(f.scheduled),
                          date: shortDateTime(f.scheduled.effectiveFrom),
                        })}
                      </p>
                    )}
                  </article>
                </li>
              ))}
            </ul>

            <section aria-labelledby="energy-history" className="card flex flex-col gap-3 p-4">
              <h2 id="energy-history" className="type-h3">
                {t('admin.energy.history')}
              </h2>
              <div
                className="overflow-x-auto"
                role="region"
                tabIndex={0}
                aria-label={t('admin.energy.historyCaption')}
              >
                <table className="w-full min-w-[34rem] border-collapse text-left text-sm leading-5">
                  <caption className="sr-only">{t('admin.energy.historyCaption')}</caption>
                  <thead>
                    <tr className="text-text-muted">
                      <th scope="col" className="py-2 pr-3 font-semibold">
                        {t('admin.energy.col.from')}
                      </th>
                      <th scope="col" className="py-2 pr-3 font-semibold">
                        {t('admin.energy.fuel')}
                      </th>
                      <th scope="col" className="py-2 pr-3 font-semibold">
                        {t('admin.energy.col.price')}
                      </th>
                      <th scope="col" className="py-2 pr-3 font-semibold">
                        {t('admin.energy.col.cons')}
                      </th>
                      <th scope="col" className="py-2 font-semibold">
                        {t('admin.energy.col.by')}
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {d.history.map((h) => (
                      <tr key={h.id} className="border-t border-border align-top">
                        <th scope="row" className="py-2 pr-3 font-normal">
                          {shortDateTime(h.effectiveFrom)}
                        </th>
                        <td className="py-2 pr-3">{fuelLabel(h.fuelType)}</td>
                        <td className="py-2 pr-3 tabular-nums">{price(h)}</td>
                        <td className="py-2 pr-3 tabular-nums">{cons(h)}</td>
                        <td className="py-2">
                          {h.createdBy?.firstName ?? t('admin.noValue')}
                          <span className="block text-text-muted">{h.sourceNote}</span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          </div>
          <div className="min-w-0 xl:order-2 xl:self-start">
            <EnergyPriceForm data={d} />
          </div>
        </div>
      )}
    </AdminView>
  );
}
