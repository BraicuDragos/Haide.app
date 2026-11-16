import { useQuery } from '@tanstack/react-query';
import { lazy, Suspense, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router';
import { ApiError } from '@/api/client';
import { keys } from '@/api/keys';
import { getPublicRide, postMatch } from '@/api/search';
import type { LatLng, MatchResponse, NotBookableReason, PublicRide } from '@/api/types';
import { useBack } from '@/app/useBack';
import { useAuth } from '@/auth/AuthProvider';
import { useGate, useMe } from '@/auth/hooks';
import { nextStep } from '@/auth/onboarding';
import { t, tError, tp, type MessageKey } from '@/i18n';
import { dayLabel } from '@/lib/dates';
import { formatRon, formatTime } from '@/lib/format';
import { Avatar } from '@/ui/Avatar';
import { Button } from '@/ui/Button';
import { EmptyState } from '@/ui/EmptyState';
import { Icon } from '@/ui/Icon';
import { Loader, MiniLoader } from '@/ui/Loader';
import { Notice } from '@/ui/Notice';
import { PageHeader } from '@/ui/PageHeader';
import { PriceRoll } from '@/ui/PriceRoll';
import { Rating } from '@/ui/Rating';
import { SeatStrip } from '@/ui/SeatPicker';
import { RequestSheet, requestErrorText } from '@/features/bookings/components/RequestSheet';
import { useQueuedRequest } from '@/features/bookings/useQueuedRequest';
import { readSearch, toPoint, type SearchCriteria } from '@/features/find/searchState';
import { PriceTable } from '@/features/rides/components/PriceTable';
import { RideStops } from '@/features/rides/components/RideStops';

// MapLibre is a lazy chunk: Find and Results never download it.
const RouteMap = lazy(() => import('@/ui/RouteMap'));

const bani = (n: number) => (n / 100).toFixed(2);

const REASON: Record<NotBookableReason, MessageKey> = {
  RIDE_FULL: 'detail.full',
  RIDE_NOT_BOOKABLE: 'detail.tooLate',
  OWN_RIDE: 'detail.ownRide',
  BLOCKED: 'detail.blocked',
  ALREADY_REQUESTED: 'detail.alreadyRequested',
  NO_LONGER_MATCHES: 'detail.noLongerMatches',
};

/** Ride detail (3.3): public view with approximate areas, what the passenger pays, and the sticky Request seat. */
export default function RideDetailScreen() {
  const { id = '' } = useParams();
  const criteria = useMemo(readSearch, []);
  const back = useBack(criteria ? '/results' : '/find');
  const q = useQuery({
    queryKey: keys.ride(id),
    queryFn: ({ signal }) => getPublicRide(id, signal),
    enabled: id.length > 0,
    retry: (n, err) => !(err instanceof ApiError && err.status === 404) && n < 1,
  });

  const header = <PageHeader title={t('detail.title')} onBack={back} />;

  if (q.isPending)
    return (
      <>
        {header}
        <div aria-busy="true">
          <Loader label={t('detail.loading')} />
        </div>
      </>
    );
  if (q.isError || !q.data) {
    const gone = q.error instanceof ApiError && q.error.status === 404;
    return (
      <>
        {header}
        {gone ? (
          <EmptyState title={t('detail.gone')} body="">
            <Link to={criteria ? '/results' : '/find'} className="btn btn-primary">
              {t('detail.gone.cta')}
            </Link>
          </EmptyState>
        ) : (
          <div className="flex flex-col items-start gap-3 p-4">
            <Notice tone="error">
              {q.error instanceof ApiError && q.error.code !== 'NETWORK'
                ? tError(q.error.code)
                : t('detail.err')}
            </Notice>
            <Button variant="secondary" onClick={() => void q.refetch()}>
              {t('common.retry')}
            </Button>
          </div>
        )}
      </>
    );
  }
  return (
    <>
      {header}
      <Detail ride={q.data} criteria={criteria} />
    </>
  );
}

function Detail({ ride, criteria }: { ride: PublicRide; criteria: SearchCriteria | null }) {
  const body = useMemo(
    () =>
      criteria ? { from: toPoint(criteria.from.point), to: toPoint(criteria.to.point) } : null,
    [criteria],
  );
  const matchQ = useQuery({
    queryKey: keys.match(ride.id, body),
    queryFn: ({ signal }) => postMatch(ride.id, body!, signal),
    enabled: body !== null,
    retry: (n, err) => !(err instanceof ApiError && err.status < 500 && err.status > 0) && n < 1,
  });
  const match = matchQ.data;
  const driver = ride.driver.firstName ?? '';

  const pickup = match?.pickup ?? { label: ride.origin.label, point: ride.origin.point, walkM: 0 };
  const dropoff = match?.dropoff ?? {
    label: ride.destination.label,
    point: ride.destination.point,
    walkM: 0,
  };
  const topPrice = match?.priceUpToBani ?? ride.priceTable[0]?.priceBani ?? 0;
  // NO_LONGER_MATCHES comes with null pickup, drop-off and price: show the ride's own areas and no match moment.
  const mp = match?.pickup ?? null;
  const md = match?.dropoff ?? null;
  const fits = mp !== null && md !== null;

  const route = useMemo(() => ride.routePublic?.coordinates, [ride.routePublic]);
  const you = useMemo(
    () => (criteria && fits ? { from: criteria.from.point, to: criteria.to.point } : undefined),
    [criteria, fits],
  );
  const km = (ride.distanceM / 1000).toFixed(1);

  return (
    <>
      <div className="flex flex-col gap-5 px-4 pt-4 pb-6">
        <div className="flex items-end justify-between gap-3">
          <div>
            <p className="vt-time type-numeral w-fit">{formatTime(ride.departureAt)}</p>
            <p className="text-text-muted">{dayLabel(ride.departureAt)}</p>
          </div>
          <div className="text-right">
            {ride.isFree ? (
              <p className="vt-price type-price w-fit text-savings">{t('card.free')}</p>
            ) : (
              <>
                <p className="text-sm leading-5 text-text-muted">{t('card.upTo')}</p>
                <p className="vt-price type-price ml-auto w-fit text-price">
                  <PriceRoll value={bani(topPrice)} label={formatRon(topPrice)} animate />{' '}
                  <span aria-hidden="true" className="type-body text-text-muted">
                    RON
                  </span>
                </p>
                <p className="text-sm leading-5 text-text-muted">{t('card.drops')}</p>
              </>
            )}
          </div>
        </div>

        <Suspense fallback={<MiniLoader label={t('map.loading')} />}>
          <RouteMap
            mode="approximate"
            pickup={pickup.point}
            dropoff={dropoff.point}
            {...(route ? { route } : {})}
            {...(you ? { you } : {})}
            {...(mp ? { fit: t('match.fit', { m: mp.walkM }) } : {})}
            description={t('detail.map.desc', { pickup: pickup.label, dropoff: dropoff.label })}
          />
        </Suspense>

        <section aria-label={t('detail.title')} className="card flex flex-col gap-4 p-4">
          <div className="vt-route">
            <RideStops from={pickup.label} to={dropoff.label} />
          </div>
          <dl className="m-0 flex flex-col gap-3">
            <Stop
              term={t('detail.pickup')}
              approx={t('detail.approx', { driver })}
              walk={mp ? t('detail.walk.to', { m: mp.walkM }) : null}
            />
            <Stop
              term={t('detail.dropoff')}
              approx={t('detail.approx', { driver })}
              walk={md ? t('detail.walk.from', { m: md.walkM }) : null}
            />
          </dl>
          <div className="flex flex-col items-start gap-2 border-t border-(color:--hair) pt-3">
            <SeatStrip total={ride.seatsOffered} taken={ride.seatsOffered - ride.seatsLeft} />
            <p className="text-sm leading-5 text-text-muted">
              {tp('detail.seatsLeft', ride.seatsLeft, { total: ride.seatsOffered })}
              {' · '}
              {t('offer.route.result', { km, min: Math.max(1, Math.round(ride.durationS / 60)) })}
            </p>
          </div>
        </section>

        <section aria-labelledby="d-driver" className="flex flex-col gap-2">
          <h2 id="d-driver" className="type-h3">
            {t('detail.driver')}
          </h2>
          <Link
            to={`/user/${ride.driver.id}`}
            className="card flex min-h-14 items-center gap-3 p-4 text-text no-underline"
          >
            <Avatar name={ride.driver.firstName} photoUrl={ride.driver.photoUrl} />
            <span className="flex min-w-0 flex-1 flex-col">
              <span className="truncate font-semibold">{driver}</span>
              <Rating rating={ride.driver.rating} />
            </span>
            <span className="text-sm leading-5 font-semibold text-on-outline">
              {t('common.viewProfile')}
            </span>
          </Link>
        </section>

        <section aria-labelledby="d-car" className="flex flex-col gap-2">
          <h2 id="d-car" className="type-h3">
            {t('detail.car')}
          </h2>
          <ul className="group">
            <li className="flex items-center gap-3 p-4">
              <Icon name="car" />
              <span>
                {t('detail.car.value', {
                  colour: ride.car.colour,
                  make: ride.car.make,
                  model: ride.car.model,
                })}
              </span>
            </li>
            <li className="flex items-start gap-3 p-4 text-text-muted">
              <Icon name="lock" className="mt-0.5" />
              <span className="flex flex-col">
                <span className="font-semibold text-text">{t('detail.plateLocked')}</span>
                <span className="text-sm leading-5">{t('detail.plateLocked.why')}</span>
              </span>
            </li>
          </ul>
        </section>

        {ride.note && (
          <section aria-labelledby="d-note" className="flex flex-col gap-1">
            <h2 id="d-note" className="type-h3">
              {t('detail.note', { driver })}
            </h2>
            <p>{ride.note}</p>
          </section>
        )}

        <section aria-labelledby="d-price" className="card flex flex-col gap-3 p-4">
          <h2 id="d-price" className="type-h3">
            {t('detail.priceTitle')}
          </h2>
          <PriceTable
            rows={ride.priceTable}
            free={ride.isFree}
            caption={t('detail.priceTable.caption')}
          />
          <p className="text-sm leading-5 text-text-muted">{t('detail.priceNote')}</p>
          <p className="text-sm leading-5">{t('detail.payDirect', { driver })}</p>
          <p className="text-sm leading-5 text-text-muted">{t('detail.fuelNote', { driver })}</p>
        </section>
      </div>

      <RequestBar
        ride={ride}
        criteria={criteria}
        body={body}
        match={match}
        matchLoading={matchQ.isPending && body !== null}
        matchError={matchQ.isError ? matchQ.error : null}
      />
    </>
  );
}

function Stop({ term, approx, walk }: { term: string; approx: string; walk: string | null }) {
  return (
    <div className="flex flex-col gap-0.5">
      <dt className="type-label">{term}</dt>
      <dd className="m-0 text-sm leading-5 text-text-muted">{approx}</dd>
      {walk && (
        <dd className="m-0 flex items-center gap-2 text-sm leading-5">
          <Icon name="walk" small />
          {walk}
        </dd>
      )}
    </div>
  );
}

/**
 * Sticky Request seat. Disabled reasons come from the ride (own ride, blocked, already requested, full) and from
 * POST /match (not bookable, no longer fits), always as words next to the button. Signed out: the tap starts
 * onboarding and returns to this ride (ADR 0010). Signed in: the request sheet (4.1) opens and the Haide launch sends
 * the request. A request queued while offline shows a note and is sent again when the device is back online.
 */
function RequestBar({
  ride,
  criteria,
  body,
  match,
  matchLoading,
  matchError,
}: {
  ride: PublicRide;
  criteria: SearchCriteria | null;
  body: { from: LatLng; to: LatLng } | null;
  match: MatchResponse | undefined;
  matchLoading: boolean;
  matchError: unknown;
}) {
  const gate = useGate();
  const { status } = useAuth();
  const me = useMe().data;
  const [params, setParams] = useSearchParams();
  const [sheet, setSheet] = useState(false);
  const returnTo = `/ride/${ride.id}?request=1`;
  const queue = useQueuedRequest(ride.id, status === 'signedIn');

  const bookingStatus = ride.viewer.bookingStatus;
  const reasonCode: NotBookableReason | null = ride.viewer.isDriver
    ? 'OWN_RIDE'
    : ride.viewer.blocked
      ? 'BLOCKED'
      : bookingStatus === 'requested' ||
          bookingStatus === 'confirmed' ||
          bookingStatus === 'rejected'
        ? 'ALREADY_REQUESTED'
        : ride.seatsLeft <= 0
          ? 'RIDE_FULL'
          : (match?.notBookableReason ?? null);
  const reason = queue.queued
    ? t('booking.queued')
    : reasonCode
      ? t(REASON[reasonCode])
      : !criteria
        ? t('detail.needSearch')
        : matchError
          ? matchError instanceof ApiError && matchError.code !== 'NETWORK'
            ? tError(matchError.code)
            : t('detail.err')
          : null;
  const disabled = reason !== null;
  const ready = body !== null && match !== undefined && !disabled;

  const request = () => {
    if (!gate({ kind: 'request', returnTo })) return;
    if (ready) setSheet(true);
  };

  // Back from onboarding with `?request=1`: the gate is cleared, so open the sheet once.
  const done = useRef(false);
  useEffect(() => {
    if (done.current || params.get('request') !== '1') return;
    if (status !== 'signedIn' || !me || matchLoading) return;
    done.current = true;
    setParams({}, { replace: true });
    if (!nextStep(me, { kind: 'request', returnTo }) && ready) setSheet(true);
  }, [params, setParams, status, me, ready, matchLoading, returnTo]);

  return (
    <div className="glass sticky bottom-0 z-10 flex flex-col gap-2 rounded-none border-x-0 border-b-0 px-4 pt-3 pb-[max(env(safe-area-inset-bottom),var(--tk-space-3))]">
      {reason && (
        <p id="req-reason" className="text-sm leading-5 font-semibold text-text-muted">
          {reason}
        </p>
      )}
      {queue.error && <Notice tone="error">{requestErrorText(queue.error)}</Notice>}
      {reasonCode === 'ALREADY_REQUESTED' && ride.viewer.bookingId && (
        <Link to={`/booking/${ride.viewer.bookingId}`} className="btn btn-secondary">
          {t('request.err.viewBooking')}
        </Link>
      )}
      <Button
        block
        disabled={disabled}
        loading={matchLoading}
        aria-describedby={reason ? 'req-reason' : undefined}
        onClick={request}
      >
        {t('detail.cta')}
      </Button>
      {!criteria && (
        <Link to="/find" className="btn btn-secondary">
          {t('detail.needSearch.cta')}
        </Link>
      )}
      {body && match && (
        <RequestSheet
          open={sheet}
          onClose={() => setSheet(false)}
          ride={ride}
          from={body.from}
          to={body.to}
          match={match}
          onQueued={queue.markQueued}
        />
      )}
    </div>
  );
}
