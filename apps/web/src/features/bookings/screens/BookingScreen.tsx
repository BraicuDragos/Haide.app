import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { lazy, Suspense, useEffect, useMemo, useRef, useState } from 'react';
import { Link, Navigate, useParams } from 'react-router';
import { getBooking, postBookingCancel, postSummarySeen } from '@/api/bookings';
import { ApiError } from '@/api/client';
import { keys } from '@/api/keys';
import type { BookingView } from '@/api/types';
import { useBack } from '@/app/useBack';
import { RequireAuth } from '@/auth/RequireAuth';
import { RideStops } from '@/features/rides/components/RideStops';
import { Call112Button } from '@/features/safety/Call112Button';
import { LazyNoShowSheet, LazyReportSheet, LazyShareSheet } from '@/features/safety/sheets';
import { t, tError, type MessageKey } from '@/i18n';
import { dayLabel } from '@/lib/dates';
import { isExactPoint, whenLabel } from '@/lib/booking';
import { formatRon, formatTime } from '@/lib/format';
import { Avatar } from '@/ui/Avatar';
import { Button } from '@/ui/Button';
import { EmptyState } from '@/ui/EmptyState';
import { Icon, type IconName } from '@/ui/Icon';
import { Loader, MiniLoader } from '@/ui/Loader';
import { Notice } from '@/ui/Notice';
import { PageHeader } from '@/ui/PageHeader';
import { PriceRoll } from '@/ui/PriceRoll';
import { Rating } from '@/ui/Rating';
import { Sheet } from '@/ui/Sheet';
import { useToast } from '@/ui/Toast';
import { BookingStatusPill } from '../components/BookingStatusPill';
import { ContactCard } from '../components/ContactCard';

// MapLibre is a lazy chunk: the entry bundle and the list screens never download it.
const RouteMap = lazy(() => import('@/ui/RouteMap'));

const BACK = '/rides';
const bani = (n: number) => (n / 100).toFixed(2);

/** Booking detail (4.2): the answer, the timeline, the map, what you pay, and (once accepted) how to reach the driver. */
export default function BookingScreen() {
  return (
    <RequireAuth title={t('booking.title')}>
      <Booking />
    </RequireAuth>
  );
}

function Booking() {
  const { id = '' } = useParams();
  const back = useBack(BACK);
  const q = useQuery({
    queryKey: keys.bookings.one(id),
    queryFn: ({ signal }) => getBooking(id, signal),
    enabled: id.length > 0,
    retry: (n, err) => !(err instanceof ApiError && err.status === 404) && n < 1,
  });

  const header = <PageHeader title={t('booking.title')} onBack={back} />;
  if (q.isPending)
    return (
      <>
        {header}
        <div aria-busy="true">
          <Loader label={t('booking.loading')} />
        </div>
      </>
    );
  if (q.isError || !q.data) {
    const gone = q.error instanceof ApiError && q.error.status === 404;
    return (
      <>
        {header}
        {gone ? (
          <EmptyState title={t('errors.NOT_FOUND')} body="">
            <Link to={BACK} className="btn btn-primary">
              {t('rides.title')}
            </Link>
          </EmptyState>
        ) : (
          <div className="flex flex-col items-start gap-3 p-4">
            <Notice tone="error">
              {q.error instanceof ApiError && q.error.code !== 'NETWORK'
                ? tError(q.error.code)
                : t('booking.err')}
            </Notice>
            <Button variant="secondary" onClick={() => void q.refetch()}>
              {t('common.retry')}
            </Button>
          </div>
        )}
      </>
    );
  }
  // The driver of this ride belongs on the driver screen.
  if (q.data.viewerRole === 'driver') return <Navigate to={`/driving/${q.data.rideId}`} replace />;
  return (
    <>
      {header}
      <Detail booking={q.data} />
    </>
  );
}

/** The banner at the top: one sentence for every state, including a cancelled ride. */
function banner(b: BookingView): {
  title: MessageKey;
  body: MessageKey | null;
  icon: IconName;
  tone: string;
} {
  // Same rule as the list pill: the whole ride was cancelled by someone other than the passenger.
  const rideCancelled =
    b.status === 'cancelled' &&
    (b.timeline.some((s) => s.status === 'ride_cancelled') ||
      (b.rideStatus === 'cancelled' && b.cancelledBy !== 'passenger'));
  if (rideCancelled)
    return {
      title: 'booking.rideCancelled.title',
      body: 'booking.rideCancelled.body',
      icon: 'alert',
      tone: 'bg-warning-bg text-warning',
    };
  switch (b.status) {
    case 'requested':
      return {
        title: 'booking.requested.title',
        body: 'booking.requested.body',
        icon: 'clock',
        tone: 'bg-info-bg text-info',
      };
    case 'confirmed':
      return {
        title: 'booking.confirmed.title',
        body: 'booking.confirmed.body',
        icon: 'check',
        tone: 'bg-success-bg text-success',
      };
    case 'rejected':
      return {
        title: 'booking.rejected.title',
        body: 'booking.rejected.body',
        icon: 'close',
        tone: 'bg-surface-subtle text-text',
      };
    case 'expired':
      return {
        title: 'booking.expired.title',
        body: 'booking.expired.body',
        icon: 'clock',
        tone: 'bg-surface-subtle text-text',
      };
    case 'completed':
      return {
        title: 'booking.completed.title',
        body: 'booking.completed.body',
        icon: 'check',
        tone: 'bg-success-bg text-success',
      };
    case 'no_show':
      return {
        title: 'booking.noShow.title',
        body:
          b.noShowBy === 'driver'
            ? 'booking.noShow.byDriver'
            : b.noShowBy === 'passenger'
              ? 'booking.noShow.byYou'
              : null,
        icon: 'alert',
        tone: 'bg-surface-subtle text-text',
      };
    default:
      return {
        title:
          b.cancelledBy === 'driver'
            ? 'booking.cancelledByDriver.title'
            : b.cancelledBy === 'system'
              ? 'booking.cancelledSystem.title'
              : 'booking.cancelled.title',
        body: b.cancelledBy === 'system' ? 'booking.cancelledSystem.body' : null,
        icon: 'close',
        tone: 'bg-surface-subtle text-text',
      };
  }
}

function Detail({ booking: b }: { booking: BookingView }) {
  const qc = useQueryClient();
  const [cancelOpen, setCancelOpen] = useState(false);
  const [sheet, setSheet] = useState<'share' | 'report' | 'noshow' | null>(null);
  const driver = b.driver.firstName ?? '';
  const info = banner(b);

  // Opening the booking marks the update as seen (badge). Once per unseen state.
  const marked = useRef(false);
  useEffect(() => {
    if (!b.unseen || marked.current) return;
    marked.current = true;
    postSummarySeen([b.id])
      .then(() => {
        void qc.invalidateQueries({ queryKey: keys.summary });
        void qc.invalidateQueries({ queryKey: keys.bookings.all });
      })
      .catch(() => {
        marked.current = false; // try again on the next visit; a failed "seen" must never break the screen
      });
  }, [b.id, b.unseen, qc]);

  const exact = isExactPoint(b.pickup.point) && isExactPoint(b.dropoff.point);
  const route = useMemo(() => b.route?.coordinates, [b.route]);
  const open = b.status === 'requested' || b.status === 'confirmed';
  const price = b.price.finalBani ?? b.price.lockedBani ?? b.price.quotedBani;
  const dropped = b.price.droppedFromBani !== null && b.price.lockedBani !== null;
  // Report a problem: any state from acceptance on (not before the driver answered, not a declined request).
  const afterAccepted =
    b.status === 'confirmed' || b.status === 'completed' || b.status === 'no_show';

  return (
    <>
      <div className="flex flex-col gap-5 px-4 pt-4 pb-6">
        <div role="status" className={`flex items-start gap-3 rounded-lg px-4 py-3 ${info.tone}`}>
          <Icon name={info.icon} className="mt-0.5" />
          <div className="flex flex-col gap-1">
            <p className="type-h3">{t(info.title, { driver })}</p>
            {info.body && (
              <p className="text-sm leading-5">
                {t(info.body, { driver, deadline: formatTime(b.expiresAt) })}
              </p>
            )}
          </div>
        </div>

        <Call112Button window={b.actions.call112Window} />

        {b.rating?.given ? (
          <p className="flex items-center gap-2 font-semibold">
            <Icon name="done" className="text-savings" />
            <span>{t('booking.rating.sent', { driver })}</span>
            <span className="text-sm leading-5 font-normal text-text-muted">
              {t('booking.rating.stars', { n: b.rating.given.stars })}
            </span>
          </p>
        ) : (
          b.actions.canRate && (
            <Link to={`/rate/${b.id}`} className="btn btn-primary">
              {t('driverRide.rate', { name: driver })}
            </Link>
          )
        )}

        <div className="flex items-end justify-between gap-3">
          <div>
            <p className="type-numeral">{formatTime(b.pickupEtaAt)}</p>
            <p className="text-text-muted">{dayLabel(b.departureAt)}</p>
          </div>
          <BookingStatusPill
            status={b.status}
            rideStatus={b.rideStatus}
            cancelledBy={b.cancelledBy}
          />
        </div>

        <section aria-labelledby="bk-progress" className="flex flex-col gap-2">
          <h2 id="bk-progress" className="type-h3">
            {t('booking.timeline')}
          </h2>
          <ol className="m-0 flex list-none flex-col gap-3 p-0">
            {b.timeline.map((step, i) => (
              <li key={`${step.status}-${step.at}`} className="flex items-center gap-3">
                <span
                  aria-hidden="true"
                  className={`timeline-dot ${i === b.timeline.length - 1 ? 'is-last' : ''}`}
                />
                <span className="font-semibold">
                  {t(`booking.step.${step.status}` as MessageKey)}
                </span>
                <span className="ml-auto text-sm leading-5 text-text-muted">
                  {whenLabel(step.at)}
                </span>
              </li>
            ))}
          </ol>
        </section>

        <Suspense fallback={<MiniLoader label={t('map.loading')} />}>
          <RouteMap
            mode={exact ? 'exact' : 'approximate'}
            pickup={b.pickup.point}
            dropoff={b.dropoff.point}
            {...(route ? { route } : {})}
            description={t('booking.map.desc', {
              pickup: b.pickup.label,
              dropoff: b.dropoff.label,
            })}
          />
        </Suspense>

        <section aria-label={t('booking.pickup')} className="card flex flex-col gap-4 p-4">
          <RideStops from={b.pickup.label} to={b.dropoff.label} />
          <dl className="m-0 flex flex-col gap-3">
            <Place
              term={t('booking.pickup')}
              exact={isExactPoint(b.pickup.point)}
              walkM={b.pickup.walkM}
              extra={t('booking.pickup.eta', { driver, time: formatTime(b.pickupEtaAt) })}
            />
            <Place
              term={t('booking.dropoff')}
              exact={isExactPoint(b.dropoff.point)}
              walkM={b.dropoff.walkM}
            />
          </dl>
          {!exact && (
            <p className="flex items-start gap-2 text-sm leading-5 text-text-muted">
              <Icon name="lock" small className="mt-0.5" />
              <span>{t('booking.locked', { driver })}</span>
            </p>
          )}
        </section>

        {b.status !== 'no_show' && (
          <section aria-labelledby="bk-pay" className="card flex flex-col gap-3 p-4">
            <h2 id="bk-pay" className="type-h3">
              {t(b.status === 'requested' ? 'booking.pay.lineUpTo' : 'booking.pay.line', {
                price: formatRon(price),
                driver,
              })}
            </h2>
            <p aria-hidden="true" className="type-price text-price">
              {b.status === 'requested' && (
                <span className="type-body mr-2 text-text-muted">{t('booking.pay.upTo')}</span>
              )}
              <PriceRoll
                value={bani(price)}
                {...(dropped ? { from: bani(b.price.droppedFromBani ?? price) } : {})}
                label={formatRon(price)}
                animate
              />{' '}
              <span className="type-body text-text-muted">RON</span>
            </p>
            {dropped && (
              <p className="flex items-start gap-2 font-semibold text-savings">
                <span aria-hidden="true" className="drop-dot" />
                <span>{t('booking.priceDropped', { price: formatRon(price) })}</span>
              </p>
            )}
            {open && <p className="text-sm leading-5">{t('booking.priceNever')}</p>}
            {b.price.finalBani !== null && (
              <p className="text-sm leading-5">{t('booking.pay.final', { driver })}</p>
            )}
            <p className="text-sm leading-5 text-text-muted">{t('booking.pay.how')}</p>
          </section>
        )}

        <ContactCard booking={b} />

        <section aria-labelledby="bk-driver" className="flex flex-col gap-2">
          <h2 id="bk-driver" className="type-h3">
            {t('detail.driver')}
          </h2>
          <ul className="group">
            <li>
              <Link
                to={`/user/${b.driver.id}`}
                className="flex min-h-14 items-center gap-3 p-4 text-text no-underline"
              >
                <Avatar name={b.driver.firstName} photoUrl={b.driver.photoUrl} />
                <span className="flex min-w-0 flex-1 flex-col">
                  <span className="truncate font-semibold">{driver}</span>
                  <Rating rating={b.driver.rating} />
                </span>
                <span className="text-sm leading-5 font-semibold text-on-outline">
                  {t('common.viewProfile')}
                </span>
              </Link>
            </li>
            <li className="flex items-center gap-3 p-4">
              <Icon name="car" />
              <span>
                {t('detail.car.value', {
                  colour: b.car.colour,
                  make: b.car.make,
                  model: b.car.model,
                })}
              </span>
            </li>
            <li className="flex items-start gap-3 p-4">
              <Icon name={b.car.plate ? 'car' : 'lock'} className="mt-0.5" />
              <span className="flex flex-col">
                <span className="text-sm leading-5 text-text-muted">{t('booking.plate')}</span>
                {b.car.plate ? (
                  <span className="type-h3 tabular-nums">{b.car.plate}</span>
                ) : (
                  <span className="text-text-muted">{t('booking.plate.hidden', { driver })}</span>
                )}
              </span>
            </li>
          </ul>
        </section>

        {b.status === 'rejected' || b.status === 'expired' || b.status === 'cancelled' ? (
          <Link to="/find" className="btn btn-primary">
            {t('booking.findAnother')}
          </Link>
        ) : null}

        {(b.actions.canShare || b.actions.canReportDriverNoShow || afterAccepted) && (
          <section aria-label={t('pub.safety')} className="flex flex-col gap-3">
            {b.actions.canShare && (
              <Button
                variant="secondary"
                block
                icon={<Icon name="share" />}
                onClick={() => setSheet('share')}
              >
                {t('rideday.share')}
              </Button>
            )}
            {b.actions.canReportDriverNoShow && (
              <Button variant="secondary" block onClick={() => setSheet('noshow')}>
                {t('rideday.driverMissing')}
              </Button>
            )}
            {afterAccepted && (
              <Button variant="ghost" block onClick={() => setSheet('report')}>
                {t('rideday.problem')}
              </Button>
            )}
          </section>
        )}

        {b.actions.canCancel && (
          <Button variant="danger" block onClick={() => setCancelOpen(true)}>
            {t('booking.cancel')}
          </Button>
        )}
      </div>

      <CancelSheet booking={b} open={cancelOpen} onClose={() => setCancelOpen(false)} />
      <LazyShareSheet open={sheet === 'share'} onClose={() => setSheet(null)} booking={b} />
      <LazyNoShowSheet
        open={sheet === 'noshow'}
        onClose={() => setSheet(null)}
        bookingId={b.id}
        rideId={b.rideId}
        as="passenger"
        name={driver}
      />
      <LazyReportSheet
        open={sheet === 'report'}
        onClose={() => setSheet(null)}
        user={{ id: b.driver.id, firstName: b.driver.firstName }}
        bookingId={b.id}
      />
    </>
  );
}

function Place({
  term,
  exact,
  walkM,
  extra,
}: {
  term: string;
  exact: boolean;
  walkM: number;
  extra?: string;
}) {
  return (
    <div className="flex flex-col gap-0.5">
      <dt className="type-label">{term}</dt>
      <dd className="m-0 text-sm leading-5 text-text-muted">
        {exact ? t('common.exact') : t('booking.pickup.approx')}
      </dd>
      {extra && <dd className="m-0 text-sm leading-5">{extra}</dd>}
      {walkM > 0 && (
        <dd className="m-0 flex items-center gap-2 text-sm leading-5">
          <Icon name="walk" small />
          {t('booking.walk', { m: walkM })}
        </dd>
      )}
    </div>
  );
}

/** Cancel booking (4.3): who is told, and the late-cancel warning straight from `actions.lateCancelIfNow`. */
function CancelSheet({
  booking: b,
  open,
  onClose,
}: {
  booking: BookingView;
  open: boolean;
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const toast = useToast();
  const [error, setError] = useState<string | null>(null);
  const driver = b.driver.firstName ?? '';
  const cancel = useMutation({
    mutationFn: () => postBookingCancel(b.id),
    onSuccess: (updated) => {
      qc.setQueryData(keys.bookings.one(b.id), updated);
      void qc.invalidateQueries({ queryKey: keys.bookings.all });
      void qc.invalidateQueries({ queryKey: keys.summary });
      void qc.invalidateQueries({ queryKey: keys.ride(b.rideId) });
      toast.show(t('booking.cancel.toast'));
      onClose();
    },
    onError: (err) => {
      const code = err instanceof ApiError ? err.code : 'NETWORK';
      setError(tError(code));
      // The booking moved on (already cancelled, ride left): show its real state behind the sheet.
      if (code === 'INVALID_STATE' || code === 'NOT_FOUND')
        void qc.invalidateQueries({ queryKey: keys.bookings.one(b.id) });
    },
  });
  const close = () => {
    if (cancel.isPending) return;
    setError(null);
    onClose();
  };

  return (
    <Sheet open={open} title={t('booking.cancel.title')} onClose={close}>
      <p>
        {b.status === 'requested'
          ? t('booking.cancel.bodyRequested')
          : t('booking.cancel.body', { driver })}
      </p>
      {b.actions.lateCancelIfNow && <Notice tone="warning">{t('booking.cancel.late')}</Notice>}
      {error && <Notice tone="error">{error}</Notice>}
      <div className="mt-auto flex flex-col gap-3">
        <Button variant="danger" block loading={cancel.isPending} onClick={() => cancel.mutate()}>
          {t('booking.cancel.confirm')}
        </Button>
        <Button variant="secondary" block disabled={cancel.isPending} onClick={close}>
          {t('booking.cancel.keep')}
        </Button>
      </div>
    </Sheet>
  );
}
