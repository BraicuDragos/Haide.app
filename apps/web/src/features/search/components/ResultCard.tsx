import { Link } from 'react-router';
import type { SearchResultItem } from '@/api/types';
import { t, tp } from '@/i18n';
import { formatRon, formatTime } from '@/lib/format';
import { useReducedMotion } from '@/lib/prefs';
import { Avatar } from '@/ui/Avatar';
import { Icon } from '@/ui/Icon';
import { PriceRoll } from '@/ui/PriceRoll';
import { Rating } from '@/ui/Rating';
import { RideStops } from '@/features/rides/components/RideStops';
import { tagCard } from '../sharedElement';

const bani = (n: number) => (n / 100).toFixed(2);

/**
 * One ride in the results (screen 3.2): time and price on top, the route full width, the two walks, then driver and
 * seats. The whole card is one link. "Up to" because the price assumes riding alone with the driver and drops as
 * others join. Time, route and price carry the shared-element names (set on tap, see sharedElement.ts).
 */
export function ResultCard({
  item,
  outsideMin,
}: {
  item: SearchResultItem;
  /** Minutes from the searched time, for the nearest-rides list. */
  outsideMin?: number;
}) {
  const reduced = useReducedMotion();
  const name = item.driver.firstName ?? '';
  return (
    <Link
      to={`/ride/${item.rideId}`}
      viewTransition={!reduced}
      onClick={(e) => tagCard(e.currentTarget)}
      className="card flex min-h-11 flex-col gap-3 p-4 text-text no-underline"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p data-vt="time" className="type-h2 w-fit tabular-nums">
            {formatTime(item.departureAt)}
          </p>
          <p className="text-sm leading-5 text-text-muted">
            {outsideMin !== undefined
              ? t('card.outsideWindow', { n: outsideMin })
              : t('card.pickupAround', { time: formatTime(item.pickupEtaAt) })}
          </p>
        </div>
        <div className="text-right">
          {item.isFree ? (
            <p data-vt="price" className="type-h2 w-fit text-savings">
              {t('card.free')}
            </p>
          ) : (
            <>
              <p className="text-sm leading-5 text-text-muted">{t('card.upTo')}</p>
              <p data-vt="price" className="type-numeral-sm ml-auto w-fit text-price">
                <PriceRoll value={bani(item.priceUpToBani)} label={formatRon(item.priceUpToBani)} />{' '}
                <span aria-hidden="true" className="text-sm font-semibold text-text-muted">
                  RON
                </span>
              </p>
            </>
          )}
        </div>
      </div>

      <div data-vt="route">
        <RideStops from={item.pickup.label} to={item.dropoff.label} />
      </div>

      <ul className="m-0 flex list-none flex-col gap-1 p-0 text-sm leading-5 text-text-muted">
        <li className="flex items-center gap-2">
          <Icon name="walk" small />
          {t('card.walkTo', { m: item.pickup.walkM })}
        </li>
        <li className="flex items-center gap-2">
          <Icon name="walk" small />
          {t('card.walkFrom', { m: item.dropoff.walkM })}
        </li>
      </ul>

      <div className="flex items-center gap-3 border-t border-(color:--hair) pt-3">
        <Avatar name={item.driver.firstName} photoUrl={item.driver.photoUrl} />
        <div className="flex min-w-0 flex-1 flex-col">
          <span className="truncate font-semibold">{name}</span>
          <Rating rating={item.driver.rating} />
        </div>
        <span className="text-sm leading-5 font-semibold whitespace-nowrap">
          {tp('card.seatsLeft', item.seatsLeft)}
        </span>
      </div>
    </Link>
  );
}
