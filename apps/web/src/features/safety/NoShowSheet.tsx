import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { ApiError } from '@/api/client';
import { keys } from '@/api/keys';
import { postNoShow } from '@/api/safety';
import type { BookingView, OwnerRide } from '@/api/types';
import { t, tError } from '@/i18n';
import { Button } from '@/ui/Button';
import { Notice } from '@/ui/Notice';
import { Sheet } from '@/ui/Sheet';
import { useToast } from '@/ui/Toast';
import { invalidateAfterSafety } from './invalidate';

export interface NoShowSheetProps {
  open: boolean;
  onClose: () => void;
  bookingId: string;
  rideId: string;
  /** Who is acting: a passenger reports the driver, a driver marks a passenger. */
  as: 'passenger' | 'driver';
  /** The other person's first name. */
  name: string;
}

/** No-show (5.4): the consequence in one sentence, confirm or back out. The window itself is checked by the server. */
export default function NoShowSheet({
  open,
  onClose,
  bookingId,
  rideId,
  as,
  name,
}: NoShowSheetProps) {
  const qc = useQueryClient();
  const toast = useToast();
  const [error, setError] = useState<string | null>(null);
  const driverActs = as === 'driver';

  useEffect(() => {
    if (open) setError(null);
  }, [open]);

  const mark = useMutation({
    mutationFn: () => postNoShow<OwnerRide | BookingView>(bookingId),
    onSuccess: (updated) => {
      qc.setQueryData(driverActs ? keys.rides.mine(rideId) : keys.bookings.one(bookingId), updated);
      invalidateAfterSafety(qc, { bookingId, rideId });
      toast.show(
        driverActs ? t('rideday.noShow.toast', { name }) : t('rideday.driverMissing.toast'),
      );
      onClose();
    },
    onError: (err) => {
      const code = err instanceof ApiError ? err.code : 'NETWORK';
      setError(tError(code));
      // The state moved on (a rating arrived, the window closed): show the real one behind the sheet.
      if (code === 'INVALID_STATE' || code === 'WINDOW_CLOSED' || code === 'NOT_FOUND')
        invalidateAfterSafety(qc, { bookingId, rideId });
    },
  });
  const close = () => {
    if (!mark.isPending) onClose();
  };

  return (
    <Sheet
      open={open}
      title={
        driverActs
          ? t('rideday.noShow.title', { name })
          : t('rideday.driverMissing.title', { driver: name })
      }
      onClose={close}
    >
      <p>{driverActs ? t('rideday.noShow.body') : t('rideday.driverMissing.body')}</p>
      {error && <Notice tone="error">{error}</Notice>}
      <div className="mt-auto flex flex-col gap-3">
        <Button variant="danger" block loading={mark.isPending} onClick={() => mark.mutate()}>
          {driverActs ? t('rideday.noShow.confirm') : t('rideday.driverMissing.confirm')}
        </Button>
        <Button variant="secondary" block disabled={mark.isPending} onClick={close}>
          {driverActs ? t('rideday.noShow.keep') : t('rideday.driverMissing.keep')}
        </Button>
      </div>
    </Sheet>
  );
}
