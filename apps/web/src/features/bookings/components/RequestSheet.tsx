import { useQueryClient } from '@tanstack/react-query';
import { useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { postBooking } from '@/api/bookings';
import { ApiError } from '@/api/client';
import { keys } from '@/api/keys';
import type { LatLng, MatchResponse, PublicRide } from '@/api/types';
import { t, tError } from '@/i18n';
import { expectedExpiry, whenLabel } from '@/lib/booking';
import { formatRon, formatTime } from '@/lib/format';
import { Button } from '@/ui/Button';
import { LaunchButton, type LaunchResult } from '@/ui/LaunchButton';
import { Notice } from '@/ui/Notice';
import { Sheet } from '@/ui/Sheet';
import { triggerPushPrompt } from '@/features/push/trigger';
import { clearPending, isOffline, keyFor, savePending } from '../pendingRequest';

interface Props {
  open: boolean;
  onClose: () => void;
  ride: PublicRide;
  from: LatLng;
  to: LatLng;
  /** The match for these places: labels and the "up to" price. */
  match: MatchResponse;
  /** Called when the request was queued (offline): the ride screen shows the "queued" note and retries. */
  onQueued: () => void;
}

/** Answers that mean "this ride cannot be requested": the button stays off until the person leaves or retries. */
const SETTLED = new Set([
  'OWN_RIDE',
  'BLOCKED',
  'ALREADY_REQUESTED',
  'RIDE_NOT_BOOKABLE',
  'RIDE_FULL',
  'NO_LONGER_MATCHES',
]);

export function requestErrorText(code: string): string {
  switch (code) {
    case 'RIDE_NOT_BOOKABLE':
      return t('request.err.late');
    case 'RIDE_FULL':
      return t('request.err.full');
    case 'ALREADY_REQUESTED':
      return t('request.err.limit');
    default:
      return tError(code);
  }
}

/**
 * Request seat (4.1): who decides, until when, what stays hidden, and the one primary action that "leaves" (moment 7).
 * The `Idempotency-Key` is made once per attempt and kept in sessionStorage. Offline (or no answer): the request is
 * queued with the same key and sent when the device is back online (useQueuedRequest). The price is the server's
 * "up to" figure, nothing is computed here.
 */
export function RequestSheet({ open, onClose, ride, from, to, match, onQueued }: Props) {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [code, setCode] = useState<string | null>(null);
  const created = useRef<string | null>(null);
  const driver = ride.driver.firstName ?? '';
  const pickup = match.pickup?.label ?? ride.origin.label;
  const dropoff = match.dropoff?.label ?? ride.destination.label;
  const upTo = match.priceUpToBani;
  const deadline = formatTime(expectedExpiry(ride.departureAt));

  async function send(): Promise<LaunchResult> {
    setCode(null);
    const key = keyFor(ride.id, from, to);
    if (isOffline()) {
      savePending({ key, rideId: ride.id, from, to, queued: true });
      return 'saved';
    }
    try {
      const view = await postBooking({ rideId: ride.id, from, to }, key);
      clearPending();
      created.current = view.id;
      qc.setQueryData(keys.bookings.one(view.id), view);
      void qc.invalidateQueries({ queryKey: keys.bookings.all });
      void qc.invalidateQueries({ queryKey: keys.summary });
      void qc.invalidateQueries({ queryKey: keys.ride(ride.id) });
      return 'sent';
    } catch (e) {
      // No answer: the server may have the request already, so keep the key and queue the retry.
      if (e instanceof ApiError && e.code === 'NETWORK') {
        savePending({ key, rideId: ride.id, from, to, queued: true });
        return 'saved';
      }
      // The server decided: this attempt is over and the next one gets a new key.
      clearPending();
      throw e;
    }
  }

  function fail(e: unknown) {
    const c = e instanceof ApiError ? e.code : 'NETWORK';
    setCode(c);
    if (SETTLED.has(c)) {
      void qc.invalidateQueries({ queryKey: keys.ride(ride.id) });
      void qc.invalidateQueries({ queryKey: keys.match(ride.id, { from, to }) });
    }
  }

  function finish(r: LaunchResult) {
    if (r === 'saved') {
      onQueued();
      onClose();
      return;
    }
    if (created.current) {
      void navigate(`/booking/${created.current}`);
      triggerPushPrompt();
    }
  }

  return (
    <Sheet open={open} title={t('request.title')} onClose={onClose}>
      <p className="text-text-muted">
        {t('request.summary', { time: whenLabel(ride.departureAt), from: pickup, to: dropoff })}
      </p>
      <p className="type-price text-price">
        {ride.isFree ? (
          t('card.free')
        ) : upTo !== null ? (
          <>
            <span className="type-body mr-2 text-text-muted">{t('card.upTo')}</span>
            {formatRon(upTo)}
          </>
        ) : null}
      </p>
      <ul className="m-0 flex list-none flex-col gap-3 p-0">
        {ride.autoAccept ? (
          <li>{t('request.line.instant', { driver })}</li>
        ) : (
          <>
            <li>{t('request.line.decides', { driver })}</li>
            <li>{t('request.line.expires', { driver, deadline })}</li>
          </>
        )}
        <li>{t('request.line.approx', { driver })}</li>
      </ul>
      {code && (
        <Notice tone="error">
          <span>{requestErrorText(code)}</span>
          {code === 'ALREADY_REQUESTED' && ride.viewer.bookingId && (
            <>
              {' '}
              <Link className="underline" to={`/booking/${ride.viewer.bookingId}`}>
                {t('request.err.viewBooking')}
              </Link>
            </>
          )}
          {code === 'NO_LONGER_MATCHES' && (
            <>
              {' '}
              <Link className="underline" to="/find">
                {t('request.err.search')}
              </Link>
            </>
          )}
        </Notice>
      )}
      <div className="mt-auto flex flex-col gap-3">
        <LaunchButton
          label={t('request.send')}
          confirmed={t('request.sent.toast')}
          saved={t('request.saved')}
          wordmark={t('launch.haide')}
          sending={t('request.sending')}
          onLaunch={send}
          onDone={finish}
          onError={fail}
          disabled={code !== null && SETTLED.has(code)}
        />
        <Button variant="secondary" block onClick={onClose}>
          {t('request.cancel')}
        </Button>
      </div>
    </Sheet>
  );
}
