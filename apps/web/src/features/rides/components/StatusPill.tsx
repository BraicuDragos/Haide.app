import type { RideStatus } from '@/api/types';
import { t } from '@/i18n';
import { Icon } from '@/ui/Icon';

/** Ride status as icon plus word (colour is never the only cue). */
export function StatusPill({ status }: { status: RideStatus }) {
  const ok = status === 'published' || status === 'completed';
  const text =
    status === 'cancelled'
      ? t('status.rideCancelled')
      : status === 'published'
        ? t('status.published')
        : status === 'completed'
          ? t('status.completed')
          : t('status.expired');
  return (
    <span
      className={`inline-flex min-h-7 items-center gap-1 rounded-full px-3 text-sm leading-5 font-semibold ${
        ok ? 'bg-success-bg text-success' : 'bg-surface-subtle text-text-muted'
      }`}
    >
      <Icon name={ok ? 'check' : 'close'} small />
      {text}
    </span>
  );
}
