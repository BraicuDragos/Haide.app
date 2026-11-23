import { Link } from 'react-router';
import type { RideListItem } from '@/api/types';
import { t, tp } from '@/i18n';
import { dayLabel } from '@/lib/dates';
import { formatTime } from '@/lib/format';
import { CancelledNote, rideCancelledWho } from './CancelledNote';
import { RideStops } from './RideStops';
import { StatusPill } from './StatusPill';

/** One ride in the Driving list (screen 2.5): time and day, route, status, seats taken, waiting requests. */
export function RideCard({ ride }: { ride: RideListItem }) {
  return (
    <Link to={`/driving/${ride.id}`} className="card flex min-h-11 flex-col gap-3 p-4 text-text">
      <div className="flex items-baseline justify-between gap-3">
        <p className="type-h2 tabular-nums">{formatTime(ride.departureAt)}</p>
        <p className="text-text-muted">{dayLabel(ride.departureAt)}</p>
      </div>
      <RideStops from={ride.originLabel} to={ride.destinationLabel} />
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <StatusPill status={ride.status} />
        {ride.pendingRequests > 0 && (
          <span className="rounded-full bg-tint px-3 text-sm leading-7 font-semibold text-on-tint">
            {tp('rides.requests', ride.pendingRequests)}
          </span>
        )}
        {(ride.toRate ?? 0) > 0 && (
          <span className="rounded-full bg-tint px-3 text-sm leading-7 font-semibold text-on-tint">
            {t('rides.toRate', { n: ride.toRate ?? 0 })}
          </span>
        )}
        <span className="ml-auto text-sm leading-5 text-text-muted">
          {t('rides.seatsTaken', { booked: ride.seatsBooked, total: ride.seatsOffered })}
        </span>
      </div>
      {ride.status === 'cancelled' && (
        <CancelledNote role="driving" who={rideCancelledWho(ride)} at={ride.cancelledAt} />
      )}
    </Link>
  );
}
