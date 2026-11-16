import type { RidePassengerItem } from '@/api/types';
import { t } from '@/i18n';
import { telHref, whatsappHref } from '@/lib/booking';
import { formatRon } from '@/lib/format';
import { Avatar } from '@/ui/Avatar';
import { Icon } from '@/ui/Icon';

/** One accepted passenger (4.5): area names, the locked price, and Call and WhatsApp while the phone is revealed. */
export function PassengerCard({ passenger: p }: { passenger: RidePassengerItem }) {
  const name = p.passenger.firstName ?? '-';
  const price = p.finalPriceBani ?? p.priceLockedBani;
  return (
    <li className="card flex flex-col gap-3 p-4">
      <div className="flex items-center gap-3">
        <Avatar name={p.passenger.firstName} photoUrl={p.passenger.photoUrl} />
        <span className="min-w-0 flex-1 truncate font-semibold">{name}</span>
        {price !== null && (
          <span className="text-sm leading-5 font-semibold text-price">
            {t('driverRide.pax.paysNow', { price: formatRon(price) })}
          </span>
        )}
      </div>
      <p className="text-sm leading-5 text-text-muted">
        {t('driverRide.request.walk', { pickup: p.pickup.label, dropoff: p.dropoff.label })}
      </p>
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
        <p className="flex items-center gap-2 text-sm leading-5 text-text-muted">
          <Icon name="lock" small />
          {t('driverRide.pax.phoneHidden')}
        </p>
      )}
    </li>
  );
}
