import { Link } from 'react-router';
import type { BookingListItem } from '@/api/types';
import { RideStops } from '@/features/rides/components/RideStops';
import { t } from '@/i18n';
import { dayLabel } from '@/lib/dates';
import { formatRon, formatTime } from '@/lib/format';
import { Avatar } from '@/ui/Avatar';
import { BookingStatusPill } from './BookingStatusPill';

/** One booking in the Riding list (4.4): time and day, areas, driver, status, price, and a dot for an unseen update. */
export function BookingCard({ booking }: { booking: BookingListItem }) {
  const driver = booking.driver.firstName ?? '';
  const pending = booking.status === 'requested';
  return (
    <Link
      to={`/booking/${booking.id}`}
      className="card relative flex min-h-11 flex-col gap-3 p-4 text-text"
    >
      <div className="flex items-baseline justify-between gap-3">
        <p className="type-h2 tabular-nums">{formatTime(booking.pickupEtaAt)}</p>
        <p className="text-text-muted">{dayLabel(booking.departureAt)}</p>
      </div>
      <RideStops from={booking.pickupLabel} to={booking.dropoffLabel} />
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <BookingStatusPill status={booking.status} rideStatus={booking.rideStatus} />
        {booking.unseen && (
          <span className="inline-flex items-center gap-1.5 text-sm leading-5 font-semibold text-text">
            <span aria-hidden="true" className="unseen-dot" />
            {t('booking.unseen')}
          </span>
        )}
        <span className="ml-auto text-right text-sm leading-5 text-text-muted">
          {pending ? `${t('booking.pay.upTo')} ` : ''}
          <span className="font-semibold text-price">{formatRon(booking.priceBani)}</span>
        </span>
      </div>
      <div className="flex items-center gap-2 border-t border-(color:--hair) pt-3">
        <Avatar name={booking.driver.firstName} photoUrl={booking.driver.photoUrl} />
        <span className="min-w-0 truncate text-sm leading-5 text-text-muted">
          {t('rides.booking.with', { driver })}
        </span>
      </div>
    </Link>
  );
}
