import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { postBookingApprove, postBookingReject } from '@/api/bookings';
import { ApiError } from '@/api/client';
import { keys } from '@/api/keys';
import type { OwnerRide, RideRequestItem } from '@/api/types';
import { t, tError } from '@/i18n';
import { formatRon, formatTime } from '@/lib/format';
import { Avatar } from '@/ui/Avatar';
import { Button } from '@/ui/Button';
import { Icon } from '@/ui/Icon';
import { Notice } from '@/ui/Notice';
import { Rating } from '@/ui/Rating';
import { useToast } from '@/ui/Toast';

const STALE = ['RIDE_FULL', 'REQUEST_EXPIRED', 'INVALID_STATE', 'NOT_FOUND', 'BLOCKED'];

/**
 * One open request (4.5): who asks (public profile only), where in area names, what they would pay if accepted, the
 * deadline as a clock time, and Accept or Decline. A seat race or an expired request is explained inline.
 * Prices come from the API (`priceIfAcceptedBani`): nothing is computed here.
 */
export function RequestCard({
  rideId,
  request: r,
  full,
  isFree,
}: {
  rideId: string;
  request: RideRequestItem;
  full: boolean;
  isFree: boolean;
}) {
  const qc = useQueryClient();
  const toast = useToast();
  const [error, setError] = useState<string | null>(null);
  const name = r.passenger.firstName ?? '';

  const settle = (updated: OwnerRide, message: string) => {
    qc.setQueryData(keys.rides.mine(rideId), updated);
    void qc.invalidateQueries({ queryKey: keys.rides.all });
    void qc.invalidateQueries({ queryKey: keys.summary });
    toast.show(message);
  };
  const onError = (err: unknown) => {
    const code = err instanceof ApiError ? err.code : 'NETWORK';
    setError(
      code === 'RIDE_FULL'
        ? t('driverRide.err.full')
        : code === 'REQUEST_EXPIRED'
          ? t('driverRide.err.expired')
          : tError(code),
    );
    // The ride moved on without us (full, expired, cancelled): show its real state.
    if (STALE.includes(code)) void qc.invalidateQueries({ queryKey: keys.rides.mine(rideId) });
  };
  const accept = useMutation({
    mutationFn: () => postBookingApprove(r.bookingId),
    onSuccess: (updated) => settle(updated, t('driverRide.accept.toast', { name })),
    onError,
  });
  const decline = useMutation({
    mutationFn: () => postBookingReject(r.bookingId),
    onSuccess: (updated) => settle(updated, t('driverRide.decline.toast')),
    onError,
  });

  return (
    <li
      className="card flex flex-col gap-3 p-4"
      aria-label={t('driverRide.request.card', { name })}
    >
      <div className="flex items-center gap-3">
        <Avatar name={r.passenger.firstName} photoUrl={r.passenger.photoUrl} />
        <span className="flex min-w-0 flex-1 flex-col">
          <span className="truncate font-semibold">{name}</span>
          <Rating rating={r.passenger.rating} />
        </span>
      </div>
      <p className="text-md leading-6">
        {t('driverRide.request.walk', { pickup: r.pickupLabel, dropoff: r.dropoffLabel })}
      </p>
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <p className="font-semibold text-price">
          {isFree
            ? t('common.free')
            : t('driverRide.request.pays', { price: formatRon(r.priceIfAcceptedBani) })}
        </p>
        <p className="flex items-center gap-1 text-sm leading-5 text-text-muted">
          <Icon name="clock" small />
          {t('driverRide.request.answerBy', { time: formatTime(r.expiresAt) })}
        </p>
      </div>
      {error && <Notice tone="error">{error}</Notice>}
      {full && !error && (
        <p className="text-sm leading-5 font-semibold text-text-muted">
          {t('driverRide.seats.full')}
        </p>
      )}
      <div className="grid grid-cols-2 gap-3">
        <Button
          variant="tonal"
          disabled={full || decline.isPending}
          loading={accept.isPending}
          onClick={() => {
            setError(null);
            accept.mutate();
          }}
          icon={<Icon name="check" />}
        >
          {t('driverRide.accept')}
        </Button>
        <Button
          variant="secondary"
          disabled={accept.isPending}
          loading={decline.isPending}
          onClick={() => {
            setError(null);
            decline.mutate();
          }}
        >
          {t('driverRide.decline')}
        </Button>
      </div>
    </li>
  );
}
