import { lazy, Suspense, type ComponentType } from 'react';
import { createBrowserRouter, Navigate } from 'react-router';
import { FindScreen } from '@/features/find/screens/FindScreen';
import { NotFoundScreen } from '@/features/common/screens/NotFoundScreen';
import { ProfileScreen } from '@/features/profile/screens/ProfileScreen';
import { Shell } from './Shell';

// Dev-only harness for the lazy map. Tree-shaken out of production builds unless VITE_ENABLE_DEV_ROUTES=true
// (the Playwright build sets it).
const DEV_ROUTES = import.meta.env.DEV || import.meta.env.VITE_ENABLE_DEV_ROUTES === 'true';
const MapDemoScreen = DEV_ROUTES
  ? lazy(() => import('@/features/common/screens/MapDemoScreen'))
  : null;
const MotionDemoScreen = DEV_ROUTES
  ? lazy(() => import('@/features/common/screens/MotionDemoScreen'))
  : null;

/** Account screens load on demand so the entry chunk stays small (initial JS budget 200 KB gzip). */
const lazyScreen = <T extends Record<string, unknown>>(
  load: () => Promise<T>,
  pick: (m: T) => ComponentType,
) => ({
  lazy: async () => ({ Component: pick(await load()) }),
});

const auth = () => import('@/features/auth/screens');
const form = () => import('@/features/profile/screens/AccountFormScreens');
const policy = () => import('@/features/policy/screens/PolicyScreen');
const offer = () => import('@/features/offer/screens/OfferScreen');
const offerDone = () => import('@/features/offer/screens/OfferDoneScreen');
const rides = () => import('@/features/rides/screens/RidesScreen');
const drivingRide = () => import('@/features/rides/screens/DrivingRideScreen');

export const router = createBrowserRouter([
  {
    element: <Shell />,
    children: [
      { index: true, element: <Navigate to="/find" replace /> },
      { path: 'find', element: <FindScreen /> },
      { path: 'offer', ...lazyScreen(offer, (m) => m.default) },
      { path: 'offer/done', ...lazyScreen(offerDone, (m) => m.default) },
      { path: 'rides', ...lazyScreen(rides, (m) => m.default) },
      { path: 'driving/:id', ...lazyScreen(drivingRide, (m) => m.default) },
      { path: 'profile', element: <ProfileScreen /> },
      { path: 'profile/edit', ...lazyScreen(form, (m) => m.EditProfileScreen) },
      { path: 'profile/car', ...lazyScreen(form, (m) => () => <m.VehicleScreen mode="edit" />) },
      { path: 'setup/profile', ...lazyScreen(form, (m) => m.ProfileSetupScreen) },
      { path: 'setup/vehicle', ...lazyScreen(form, (m) => () => <m.VehicleScreen mode="setup" />) },
      {
        path: 'user/:id',
        ...lazyScreen(
          () => import('@/features/profile/screens/PublicProfileScreen'),
          (m) => m.PublicProfileScreen,
        ),
      },
      { path: 'auth', ...lazyScreen(auth, (m) => m.SignInScreen) },
      { path: 'auth/check', ...lazyScreen(auth, (m) => m.CheckEmailScreen) },
      { path: 'auth/callback', ...lazyScreen(auth, (m) => m.CallbackScreen) },
      { path: 'auth/consent', ...lazyScreen(auth, (m) => m.ConsentScreen) },
      { path: 'policy/terms', ...lazyScreen(policy, (m) => m.TermsScreen) },
      { path: 'policy/privacy', ...lazyScreen(policy, (m) => m.PrivacyScreen) },
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
      ...(MotionDemoScreen
        ? [
            {
              path: 'dev/motion',
              element: (
                <Suspense fallback={null}>
                  <MotionDemoScreen />
                </Suspense>
              ),
            },
          ]
        : []),
      { path: '*', element: <NotFoundScreen /> },
    ],
  },
]);
