import type { BookingListItem, RideListItem } from '@/api/types';
import { t, type MessageKey } from '@/i18n';
import { bucharestToday, dateLabel } from '@/lib/dates';

type Who = 'you' | 'driver' | 'system';

/** Driver's view: the ride was cancelled by the driver (old rows hold no value and read as the driver) or by Haide. */
export function rideCancelledWho(ride: Pick<RideListItem, 'cancelledBy'>): Who {
  return ride.cancelledBy === 'system' ? 'system' : 'you';
}

/**
 * Passenger's view of a cancelled booking. A booking without a recorded canceller on a cancelled ride was cancelled
 * with the ride, by the driver. No value on a booking of a live ride: nothing to say.
 */
export function bookingCancelledWho(
  b: Pick<BookingListItem, 'cancelledBy' | 'rideStatus'>,
): Who | null {
  if (b.cancelledBy === 'passenger') return 'you';
  if (b.cancelledBy === 'system') return 'system';
  if (b.cancelledBy === 'driver' || b.rideStatus === 'cancelled') return 'driver';
  return null;
}

const KEY: Record<'driving' | 'riding', Record<Who, MessageKey>> = {
  driving: {
    you: 'rides.cancelledBy.you.driving',
    driver: 'rides.cancelledBy.you.driving',
    system: 'rides.cancelledBy.system',
  },
  riding: {
    you: 'rides.cancelledBy.you.riding',
    driver: 'rides.cancelledBy.driver',
    system: 'rides.cancelledBy.system',
  },
};

/** "Cancelled by the driver" and the day it happened. No reason: none is stored. */
export function CancelledNote({
  role,
  who,
  at,
}: {
  role: 'driving' | 'riding';
  who: Who | null;
  at: string | null | undefined;
}) {
  const date = at ? t('rides.cancelledOn', { date: dateLabel(bucharestToday(new Date(at))) }) : '';
  const text = who ? t(KEY[role][who]) : '';
  if (!text && !date) return null;
  return (
    <p className="text-sm leading-5 text-text-muted">{[text, date].filter(Boolean).join(' · ')}</p>
  );
}
