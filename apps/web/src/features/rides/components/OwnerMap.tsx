import { lazy, Suspense } from 'react';
import type { OwnerRide } from '@/api/types';
import { t } from '@/i18n';
import { MiniLoader } from '@/ui/Loader';

// MapLibre is a lazy chunk: the entry bundle and the list screens never download it.
const RouteMap = lazy(() => import('@/ui/RouteMap'));

/** The driver's own ride on the exact map (RouteMap + RouteOverlay). The text description sits under it. */
export function OwnerMap({ ride }: { ride: OwnerRide }) {
  return (
    <Suspense fallback={<MiniLoader label={t('map.loading')} />}>
      <RouteMap
        mode="exact"
        pickup={ride.origin.point}
        dropoff={ride.destination.point}
        route={ride.route.coordinates}
        description={t('driverRide.request.route', {
          pickup: ride.origin.label,
          dropoff: ride.destination.label,
        })}
      />
    </Suspense>
  );
}
