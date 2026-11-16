import { useQuery } from '@tanstack/react-query';
import { Link, Navigate, useLocation } from 'react-router';
import { getMyRide } from '@/api/rides';
import { keys } from '@/api/keys';
import { RequireAuth } from '@/auth/RequireAuth';
import { t } from '@/i18n';
import { dayLabel } from '@/lib/dates';
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
  const rideId = (useLocation().state as { rideId?: string } | null)?.rideId;
  if (!rideId) return <Navigate to="/offer" replace />;
  return (
    <RequireAuth title={t('offer.done.title')}>
      <Done rideId={rideId} />
    </RequireAuth>
  );
}

function Done({ rideId }: { rideId: string }) {
  const q = useQuery({
    queryKey: keys.rides.mine(rideId),
    queryFn: ({ signal }) => getMyRide(rideId, signal),
  });
  const ride = q.data;
  return (
    <>
      <PageHeader title={t('offer.done.title')} />
      <div className="flex flex-col gap-5 px-4 pt-4 pb-6">
        <p role="status" className="text-text-muted">
          {t('offer.done.body')}
        </p>
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
        <Link to={`/driving/${rideId}`} className="btn btn-primary btn-block">
          {t('offer.done.view')}
        </Link>
        <Link to="/offer" replace className="btn btn-secondary btn-block">
          {t('offer.done.another')}
        </Link>
      </div>
    </>
  );
}
