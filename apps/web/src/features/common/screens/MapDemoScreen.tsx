import { lazy, Suspense } from 'react';
import { t } from '@/i18n';
import { PageHeader } from '@/ui/PageHeader';

const RouteMap = lazy(() => import('@/ui/RouteMap'));

// Dev and e2e harness for <RouteMap>. Real screens (ride detail, booking) arrive with E3 and E4.
const PICKUP = { lat: 45.7105, lng: 24.153 };
const DROPOFF = { lat: 45.7972, lng: 24.1521 };

export default function MapDemoScreen() {
  return (
    <>
      <PageHeader title="Map demo" />
      <div className="flex flex-col gap-4 p-4">
        <Suspense fallback={<p role="status">{t('map.loading')}</p>}>
          <RouteMap
            mode="approximate"
            pickup={PICKUP}
            dropoff={DROPOFF}
            description={`${t('map.pickup')}: Cisnădie. ${t('map.dropoff')}: Piața Mare.`}
          />
          <RouteMap
            mode="exact"
            pickup={PICKUP}
            dropoff={DROPOFF}
            description={`${t('map.pickup')}: Cisnădie. ${t('map.dropoff')}: Piața Mare.`}
          />
        </Suspense>
      </div>
    </>
  );
}
