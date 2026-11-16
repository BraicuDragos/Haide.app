import { Link } from 'react-router';
import type { RidePassengerItem } from '@/api/types';
import { t } from '@/i18n';
import { telHref, whatsappHref } from '@/lib/booking';
import { formatRon } from '@/lib/format';
import { Avatar } from '@/ui/Avatar';
import { Button } from '@/ui/Button';
import { Icon } from '@/ui/Icon';

export type PassengerAction = 'noshow' | 'report' | 'block';

/**
 * One accepted passenger (4.5, 5.4): area names, the locked price, Call and WhatsApp while the phone is revealed,
 * and from departure on the trust actions the server allows (`canMarkNoShow`, `canRate`), plus report and block.
 */
export function PassengerCard({
  passenger: p,
  onAction,
}: {
  passenger: RidePassengerItem;
  onAction: (action: PassengerAction, passenger: RidePassengerItem) => void;
}) {
  const name = p.passenger.firstName ?? '-';
  const price = p.finalPriceBani ?? p.priceLockedBani;
  const noShow = p.status === 'no_show';
  const completed = p.status === 'completed';
  // Report and block: any state from acceptance on, same rule as the passenger side.
  const trustable = p.status === 'confirmed' || completed || noShow;
  return (
    <li className="card flex flex-col gap-3 p-4" aria-label={name}>
      <div className="flex items-center gap-3">
        <Avatar name={p.passenger.firstName} photoUrl={p.passenger.photoUrl} />
        <span className="min-w-0 flex-1 truncate font-semibold">{name}</span>
        {price !== null && !noShow && (
          <span className="text-sm leading-5 font-semibold text-price">
            {t('driverRide.pax.paysNow', { price: formatRon(price) })}
          </span>
        )}
      </div>
      <p className="text-sm leading-5 text-text-muted">
        {t('driverRide.request.walk', { pickup: p.pickup.label, dropoff: p.dropoff.label })}
      </p>

      {noShow && (
        <p className="flex items-center gap-2 text-sm leading-5 font-semibold">
          <Icon name="alert" small />
          {t('driverRide.pax.noShow')}
        </p>
      )}
      {completed && (
        <p className="flex items-center gap-2 text-sm leading-5 font-semibold text-success">
          <Icon name="check" small />
          {t('driverRide.pax.done')}
        </p>
      )}

      {p.phoneE164 ? (
        <div className="grid grid-cols-2 gap-3">
          <a
            href={telHref(p.phoneE164)}
            aria-label={t('driverRide.pax.call', { name })}
            className="btn btn-tonal"
          >
            <Icon name="phone" />
            {t('booking.call')}
          </a>
          <a
            href={whatsappHref(p.phoneE164)}
            target="_blank"
            rel="noopener noreferrer"
            aria-label={t('driverRide.pax.whatsapp', { name })}
            className="btn btn-tonal"
          >
            <Icon name="chat" />
            {t('booking.whatsapp')}
          </a>
        </div>
      ) : (
        !noShow && (
          <p className="flex items-center gap-2 text-sm leading-5 text-text-muted">
            <Icon name="lock" small />
            {t('driverRide.pax.phoneHidden')}
          </p>
        )
      )}

      {p.ratingGiven ? (
        <p className="flex flex-wrap items-center gap-x-2 text-sm leading-5 font-semibold">
          <Icon name="done" small className="text-savings" />
          <span>{t('driverRide.pax.rated', { name })}</span>
          <span className="font-normal text-text-muted">
            {t('booking.rating.stars', { n: p.ratingGiven.stars })}
          </span>
        </p>
      ) : (
        p.canRate && (
          <Link to={`/rate/${p.bookingId}`} className="btn btn-primary">
            {t('driverRide.rate', { name })}
          </Link>
        )
      )}

      {p.canMarkNoShow && (
        <Button
          variant="secondary"
          block
          aria-label={t('driverRide.pax.noShow.label', { name })}
          onClick={() => onAction('noshow', p)}
        >
          {t('rideday.noShow')}
        </Button>
      )}

      {trustable && (
        <div className="grid grid-cols-2 gap-3">
          <Button variant="ghost" onClick={() => onAction('report', p)}>
            {t('report.title', { name })}
          </Button>
          <Button variant="ghost" onClick={() => onAction('block', p)}>
            {t('block.confirm', { name })}
          </Button>
        </div>
      )}
    </li>
  );
}
