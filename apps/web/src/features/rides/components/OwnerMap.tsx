import { lazy, Suspense, useMemo } from 'react';
import type { OwnerRide } from '@/api/types';
import { t } from '@/i18n';
import { isExactPoint } from '@/lib/booking';
import { MiniLoader } from '@/ui/Loader';

// MapLibre is a lazy chunk: the entry bundle and the list screens never download it.
const RouteMap = lazy(() => import('@/ui/RouteMap'));

/** The driver's own ride on the exact map (RouteMap + RouteOverlay). The text description sits under it. */
export function OwnerMap({ ride }: { ride: OwnerRide }) {
  // Exact pickup points of accepted passengers (approximate ones would mislead on an exact map).
  const pins = useMemo(
    () =>
      ride.passengers
        .filter((p) => isExactPoint(p.pickup.point))
        .map((p) => ({ lat: p.pickup.point.lat, lng: p.pickup.point.lng })),
    [ride.passengers],
  );
  return (
    <Suspense fallback={<MiniLoader label={t('map.loading')} />}>
      <RouteMap
        mode="exact"
        pickup={ride.origin.point}
        dropoff={ride.destination.point}
        route={ride.route.coordinates}
        {...(pins.length > 0 ? { pins } : {})}
        description={t('driverRide.request.route', {
          pickup: ride.origin.label,
          dropoff: ride.destination.label,
        })}
      />
    </Suspense>
  );
}
