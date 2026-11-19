import { useQuery } from '@tanstack/react-query';
import { Link, Navigate, useLocation } from 'react-router';
import type { SeriesCreated } from '@/api/liquidity';
import { getMyRide } from '@/api/rides';
import { keys } from '@/api/keys';
import { RequireAuth } from '@/auth/RequireAuth';
import { t, tp, type MessageKey } from '@/i18n';
import { dateLabel, dayLabel } from '@/lib/dates';
import { formatTime } from '@/lib/format';
import { OwnerMap } from '@/features/rides/components/OwnerMap';
import { RideStops } from '@/features/rides/components/RideStops';
import { Loader } from '@/ui/Loader';
import { Notice } from '@/ui/Notice';
import { PageHeader } from '@/ui/PageHeader';
import { tError } from '@/i18n';
import { ApiError } from '@/api/client';

/** Ride published (2.4): confirmation, the exact route, and the two next steps. Reached only from the publish form. */
export default function OfferDoneScreen() {
  const state = useLocation().state as { rideId?: string; series?: SeriesCreated | null } | null;
  const rideId = state?.rideId;
  if (!rideId) return <Navigate to="/offer" replace />;
  return (
    <RequireAuth title={t('offer.done.title')}>
      <Done rideId={rideId} series={state?.series ?? null} />
    </RequireAuth>
  );
}

function Done({ rideId, series }: { rideId: string; series: SeriesCreated | null }) {
  const q = useQuery({
    queryKey: keys.rides.mine(rideId),
    queryFn: ({ signal }) => getMyRide(rideId, signal),
  });
  const ride = q.data;
  return (
    <>
      <PageHeader title={series ? t('offer.done.series.title') : t('offer.done.title')} />
      <div className="flex flex-col gap-5 px-4 pt-4 pb-6">
        <p role="status" className="text-text-muted">
          {series ? tp('offer.done.series.body', series.created.length) : t('offer.done.body')}
        </p>
        {series && <SeriesSummary series={series} />}
        {q.isPending && (
          <div aria-busy="true">
            <Loader />
          </div>
        )}
        {q.isError && (
          <Notice tone="error">
            {tError(q.error instanceof ApiError ? q.error.code : undefined)}
          </Notice>
        )}
        {ride && (
          <>
            <OwnerMap ride={ride} />
            <section className="card flex flex-col gap-3 p-4" aria-label={t('driverRide.title')}>
              <div>
                <p className="type-numeral">{formatTime(ride.departureAt)}</p>
                <p className="text-text-muted">{dayLabel(ride.departureAt)}</p>
              </div>
              <RideStops from={ride.origin.label} to={ride.destination.label} />
            </section>
          </>
        )}
        <Link
          to={series ? '/rides?role=driving' : `/driving/${rideId}`}
          className="btn btn-primary btn-block"
        >
          {series ? t('offer.done.series.view') : t('offer.done.view')}
        </Link>
        <Link to="/offer" replace className="btn btn-secondary btn-block">
          {t('offer.done.another')}
        </Link>
      </div>
    </>
  );
}

/** What a series created, and every date it left out with the reason in words (E8-1). */
function SeriesSummary({ series }: { series: SeriesCreated }) {
  const s = series.series;
  const days = s.weekdays.map((d) => t(`weekday.${d}.short`)).join(', ');
  return (
    <section className="flex flex-col gap-3" aria-label={t('offer.done.series.title')}>
      <p className="font-semibold">
        {t('offer.done.series.when', {
          days,
          time:
            s.departureTime ||
            formatTime(series.created[0]?.departureAt ?? new Date().toISOString()),
          date: dateLabel(s.endsOn),
        })}
      </p>
      {series.skipped.length > 0 && (
        <div className="flex flex-col gap-2">
          <h2 className="type-h3">{t('offer.done.skipped.title')}</h2>
          <ul className="m-0 flex list-none flex-col gap-2 p-0">
            {series.skipped.map((k) => (
              <li key={k.date}>
                <Notice tone="warning">
                  {t('offer.done.skipped', {
                    date: dateLabel(k.date),
                    reason: t(`series.skip.${k.code}` as MessageKey),
                  })}
                </Notice>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}
