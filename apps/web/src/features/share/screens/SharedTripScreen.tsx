import { useQuery } from '@tanstack/react-query';
import { lazy, Suspense, useEffect, useMemo } from 'react';
import { useParams } from 'react-router';
import { ApiError } from '@/api/client';
import { keys } from '@/api/keys';
import { getSharedTrip } from '@/api/safety';
import type { SharedTrip } from '@/api/types';
import { ErrorBoundary } from '@/app/ErrorBoundary';
import { RideStops } from '@/features/rides/components/RideStops';
import { t, type MessageKey } from '@/i18n';
import { dayLabel } from '@/lib/dates';
import { formatTime } from '@/lib/format';
import { Avatar } from '@/ui/Avatar';
import { Button } from '@/ui/Button';
import { EmptyState } from '@/ui/EmptyState';
import { Icon, type IconName } from '@/ui/Icon';
import { Loader, MiniLoader } from '@/ui/Loader';
import { Notice } from '@/ui/Notice';
import { PageHeader } from '@/ui/PageHeader';

const RouteMap = lazy(() => import('@/ui/RouteMap'));

/** The route template telemetry sees for this page: never the token. */
export const SHARE_ROUTE = '/s/:token';

/**
 * The link is a secret and the page is not for search engines: no referrer leaves the page (the token is in the URL)
 * and robots are told to stay away. The same two rules are sent as headers by the host (public/_headers); these tags
 * cover the in-app navigation and any host that ignores the file.
 */
function useSharePrivacy() {
  useEffect(() => {
    const added: HTMLMetaElement[] = [];
    for (const [name, content] of [
      ['referrer', 'no-referrer'],
      ['robots', 'noindex, nofollow'],
    ] as const) {
      const m = document.createElement('meta');
      m.name = name;
      m.content = content;
      document.head.appendChild(m);
      added.push(m);
    }
    return () => added.forEach((m) => m.remove());
  }, []);
}

const PHASE: Record<SharedTrip['phase'], { text: MessageKey; icon: IconName }> = {
  before: { text: 'share.phase.before', icon: 'clock' },
  underway: { text: 'share.phase.underway', icon: 'car' },
  done: { text: 'share.phase.done', icon: 'check' },
};

/**
 * Shared trip (5.5b): what a person you trust sees. Read-only, no account, no phone numbers. It shows the driver's
 * first name and photo, the car with its plate, the passenger's own part of the route and the times.
 */
export default function SharedTripScreen() {
  const { token = '' } = useParams();
  useSharePrivacy();
  return (
    <div className="mx-auto flex min-h-dvh w-full max-w-xl flex-col bg-bg md:border-x md:border-(color:--hair)">
      <main id="main" tabIndex={-1} className="flex min-w-0 flex-1 flex-col">
        <ErrorBoundary route={SHARE_ROUTE} resetKey={token}>
          <Trip token={token} />
        </ErrorBoundary>
      </main>
    </div>
  );
}

function Trip({ token }: { token: string }) {
  const q = useQuery({
    queryKey: keys.sharedTrip(token),
    queryFn: ({ signal }) => getSharedTrip(token, signal),
    retry: (n, err) => !(err instanceof ApiError && err.status === 404) && n < 1,
    // The phase moves on its own: keep the page honest while it is open and visible.
    refetchInterval: 60_000,
    staleTime: 0,
  });

  if (q.isPending)
    return (
      <>
        <PageHeader title={t('app.name')} />
        <div aria-busy="true">
          <Loader label={t('share.loading')} />
        </div>
      </>
    );
  if (q.isError || !q.data) {
    const gone = q.error instanceof ApiError && q.error.status === 404;
    return (
      <>
        <PageHeader title={gone ? t('share.gone.title') : t('app.name')} />
        {gone ? (
          <EmptyState title={t('share.gone.title')} body={t('share.gone.body')} />
        ) : (
          <div className="flex flex-col items-start gap-3 p-4">
            <Notice tone="error">{t('share.err')}</Notice>
            <Button variant="secondary" onClick={() => void q.refetch()}>
              {t('common.retry')}
            </Button>
          </div>
        )}
      </>
    );
  }
  return <TripView trip={q.data} />;
}

function TripView({ trip }: { trip: SharedTrip }) {
  const driver = trip.driver.firstName;
  const phase = PHASE[trip.phase];
  const ends = useMemo(() => {
    const c = trip.route?.coordinates;
    if (!c || c.length < 2) return null;
    const a = c[0]!;
    const b = c[c.length - 1]!;
    return { pickup: { lng: a[0]!, lat: a[1]! }, dropoff: { lng: b[0]!, lat: b[1]! } };
  }, [trip.route]);

  return (
    <>
      <PageHeader title={t('share.title', { driver })} />
      <div className="flex flex-col gap-5 px-4 pt-4 pb-8">
        <div className="flex items-center gap-4">
          <Avatar name={driver} photoUrl={trip.driver.photoUrl} size="lg" />
          <div className="flex min-w-0 flex-col gap-1">
            <p className="type-numeral">{formatTime(trip.departureAt)}</p>
            <p className="text-text-muted">
              {dayLabel(trip.departureAt)} ·{' '}
              {t('share.leaves', { time: formatTime(trip.departureAt) })}
            </p>
          </div>
        </div>

        <p className="inline-flex w-fit items-center gap-2 rounded-full bg-info-bg px-4 py-2 font-semibold text-info">
          <Icon name={phase.icon} small />
          {t(phase.text)}
        </p>

        <section aria-labelledby="sh-car" className="card flex flex-col gap-3 p-4">
          <h2 id="sh-car" className="type-label">
            {t('booking.car')}
          </h2>
          <p
            className="type-numeral tabular-nums"
            aria-label={`${t('booking.plate')} ${trip.car.plate}`}
          >
            {trip.car.plate}
          </p>
          <p className="flex items-center gap-2 text-text-muted">
            <Icon name="car" small />
            {t('detail.car.value', {
              colour: trip.car.colour,
              make: trip.car.make,
              model: trip.car.model,
            })}
          </p>
        </section>

        <section
          aria-label={t('share.route', { pickup: trip.pickup.label, dropoff: trip.dropoff.label })}
          className="card flex flex-col gap-3 p-4"
        >
          <RideStops from={trip.pickup.label} to={trip.dropoff.label} />
        </section>

        {ends && trip.route && (
          <Suspense fallback={<MiniLoader label={t('map.loading')} />}>
            <RouteMap
              mode="exact"
              pickup={ends.pickup}
              dropoff={ends.dropoff}
              route={trip.route.coordinates}
              description={t('share.map.desc', {
                pickup: trip.pickup.label,
                dropoff: trip.dropoff.label,
              })}
            />
          </Suspense>
        )}

        <p className="text-sm leading-5 text-text-muted">{t('share.readOnly')}</p>
        <p className="text-sm leading-5 text-text-muted">
          {t('share.expires', { time: formatTime(trip.expiresAt) })}
        </p>

        <section aria-labelledby="sh-112" className="flex flex-col gap-2">
          <h2 id="sh-112" className="type-label">
            {t('share.emergency')}
          </h2>
          <a href="tel:112" aria-label={t('a11y.call112')} className="btn btn-danger btn-block">
            <Icon name="phone" />
            {t('rideday.call112')}
          </a>
        </section>
      </div>
    </>
  );
}
