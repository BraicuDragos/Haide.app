import { lazy, Suspense } from 'react';
import { createBrowserRouter, Navigate } from 'react-router';
import { FindScreen } from '@/features/find/screens/FindScreen';
import { NotFoundScreen } from '@/features/common/screens/NotFoundScreen';
import { OfferScreen } from '@/features/offer/screens/OfferScreen';
import { ProfileScreen } from '@/features/profile/screens/ProfileScreen';
import { RidesScreen } from '@/features/rides/screens/RidesScreen';
import { Shell } from './Shell';

// Dev-only harness for the lazy map. Tree-shaken out of production builds unless VITE_ENABLE_DEV_ROUTES=true
// (the Playwright build sets it).
const DEV_ROUTES = import.meta.env.DEV || import.meta.env.VITE_ENABLE_DEV_ROUTES === 'true';
const MapDemoScreen = DEV_ROUTES
  ? lazy(() => import('@/features/common/screens/MapDemoScreen'))
  : null;

export const router = createBrowserRouter([
  {
    element: <Shell />,
    children: [
      { index: true, element: <Navigate to="/find" replace /> },
      { path: 'find', element: <FindScreen /> },
      { path: 'offer', element: <OfferScreen /> },
      { path: 'rides', element: <RidesScreen /> },
      { path: 'profile', element: <ProfileScreen /> },
      ...(MapDemoScreen
        ? [
            {
              path: 'dev/map',
              element: (
                <Suspense fallback={null}>
                  <MapDemoScreen />
                </Suspense>
              ),
            },
          ]
        : []),
      { path: '*', element: <NotFoundScreen /> },
    ],
  },
]);
