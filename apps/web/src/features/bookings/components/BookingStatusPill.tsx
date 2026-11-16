import type { BookingStatus, RideStatus } from '@/api/types';
import { t, type MessageKey } from '@/i18n';
import { Icon, type IconName } from '@/ui/Icon';

type Tone = 'ok' | 'wait' | 'off';

const TONE_CLASS: Record<Tone, string> = {
  ok: 'bg-success-bg text-success',
  wait: 'bg-info-bg text-info',
  off: 'bg-surface-subtle text-text-muted',
};

/** Label key and look per state. Icon plus word: colour is never the only cue (copy.md section 21). */
export function statusParts(
  status: BookingStatus,
  rideStatus?: RideStatus,
): { label: MessageKey; icon: IconName; tone: Tone } {
  if (status === 'cancelled' && rideStatus === 'cancelled')
    return { label: 'status.rideCancelled', icon: 'close', tone: 'off' };
  switch (status) {
    case 'requested':
      return { label: 'status.requested', icon: 'clock', tone: 'wait' };
    case 'confirmed':
      return { label: 'status.confirmed', icon: 'check', tone: 'ok' };
    case 'completed':
      return { label: 'status.completed', icon: 'check', tone: 'ok' };
    case 'rejected':
      return { label: 'status.rejected', icon: 'close', tone: 'off' };
    case 'expired':
      return { label: 'status.expired', icon: 'clock', tone: 'off' };
    case 'no_show':
      return { label: 'status.no_show', icon: 'alert', tone: 'off' };
    default:
      return { label: 'status.cancelled', icon: 'close', tone: 'off' };
  }
}

export function BookingStatusPill({
  status,
  rideStatus,
}: {
  status: BookingStatus;
  rideStatus?: RideStatus;
}) {
  const { label, icon, tone } = statusParts(status, rideStatus);
  return (
    <span
      className={`inline-flex min-h-7 items-center gap-1 rounded-full px-3 text-sm leading-5 font-semibold ${TONE_CLASS[tone]}`}
    >
      <Icon name={icon} small />
      {t(label)}
    </span>
  );
}
