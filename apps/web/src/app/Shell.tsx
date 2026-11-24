import { lazy, Suspense, useEffect, useState } from 'react';
import { Navigate, Outlet, useLocation, useMatches } from 'react-router';
import { ApiError } from '@/api/client';
import { useAuth } from '@/auth/AuthProvider';
import { useMe } from '@/auth/hooks';
import { t } from '@/i18n';
import { Icon } from '@/ui/Icon';
import { useToast } from '@/ui/Toast';
import { PushHost } from '@/features/push/PushHost';
import { ErrorBoundary } from './ErrorBoundary';
import { TabBar, TABS } from './TabBar';
import { useNavigationCounter } from './useScreenHeading';
import { useTabSwipe } from './useTabSwipe';

/** Known route templates only: raw URLs never go to telemetry (conventions section 6). */
export function routeTemplate(pathname: string): string {
  return TABS.some((tab) => tab.to === pathname) ? pathname : '/:other';
}

const TABS_PATHS = TABS.map((tab) => tab.to);

const SuspendedScreen = lazy(() => import('@/features/common/screens/SuspendedScreen'));

/** Public browsing stays available to a suspended account (5.7). Everything else shows the suspended screen. */
const OPEN_TO_SUSPENDED = ['/find', '/results', '/ride/', '/user/', '/policy/', '/auth', '/delete'];

/** Where a person who has to re-accept updated terms can still go (they must be able to read them, leave or delete). */
const OPEN_TO_REACCEPT = ['/policy/', '/auth', '/delete'];

function useOnline(): boolean {
  const [online, setOnline] = useState(() => navigator.onLine);
  useEffect(() => {
    const up = () => setOnline(true);
    const down = () => setOnline(false);
    window.addEventListener('online', up);
    window.addEventListener('offline', down);
    return () => {
      window.removeEventListener('online', up);
      window.removeEventListener('offline', down);
    };
  }, []);
  return online;
}

/**
 * App shell: skip link, offline banner, main landmark, bottom tab bar on the four root screens.
 * Deeper screens hide the tab bar so the sticky action owns the bottom edge (ia-and-flows 2.1).
 */
export function Shell() {
  const loc = useLocation();
  const online = useOnline();
  useNavigationCounter();
  const tabIndex = TABS.findIndex((tab) => tab.to === loc.pathname);
  const isRoot = tabIndex >= 0;
  const [surface, setSurface] = useState<HTMLDivElement | null>(null);
  const { status, signOut } = useAuth();
  const toast = useToast();
  const me = useMe();
  // Routes that opt in with handle: { wide: true } (admin) drop the narrow phone column.
  const wide = useMatches().some(
    (m) => (m.handle as { wide?: boolean } | undefined)?.wide === true,
  );

  // The account was deleted (here or on another device): drop the session and say why.
  const deleted = me.error instanceof ApiError && me.error.code === 'ACCOUNT_DELETED';
  useEffect(() => {
    if (status !== 'signedIn' || !deleted) return;
    void signOut().then(() => toast.show(t('errors.ACCOUNT_DELETED')));
  }, [status, deleted, signOut, toast]);

  const suspended =
    status === 'signedIn' &&
    me.error instanceof ApiError &&
    me.error.code === 'ACCOUNT_SUSPENDED' &&
    !OPEN_TO_SUSPENDED.some((p) => loc.pathname === p || loc.pathname.startsWith(p));

  // Swipe left/right between the four root tabs (only on those screens; see useTabSwipe).
  useTabSwipe(surface, { paths: TABS_PATHS, index: tabIndex, enabled: isRoot && !suspended });

  // Terms or privacy changed since the person accepted: every screen but the legal pages asks for re-acceptance first.
  const reaccept =
    status === 'signedIn' &&
    me.data?.consent.reaccept === true &&
    !OPEN_TO_REACCEPT.some((p) => loc.pathname === p || loc.pathname.startsWith(p));
  if (reaccept) {
    const returnTo = loc.pathname + loc.search;
    return <Navigate to={`/auth/consent?returnTo=${encodeURIComponent(returnTo)}`} replace />;
  }

  return (
    <div
      ref={setSurface}
      style={{ touchAction: isRoot ? 'pan-y pinch-zoom' : undefined }}
      className={`mx-auto flex min-h-dvh w-full flex-col bg-bg ${wide ? 'max-w-7xl' : 'max-w-xl md:border-x md:border-(color:--hair)'}`}
    >
      <a
        href="#main"
        className="absolute top-2 left-2 z-50 -translate-y-24 rounded-full bg-text px-4 py-3 font-semibold text-bg focus:translate-y-0"
      >
        {t('common.skipToMain')}
      </a>
      {!online && (
        <div
          role="status"
          className="flex items-center gap-2 bg-warning-bg px-4 py-2 text-sm leading-5 font-semibold text-warning"
        >
          <Icon name="alert" small />
          <span>{t('error.offline.banner')}</span>
        </div>
      )}
      <main id="main" tabIndex={-1} className="flex min-w-0 flex-1 flex-col">
        <ErrorBoundary route={routeTemplate(loc.pathname)} resetKey={loc.key}>
          {suspended ? (
            <Suspense fallback={null}>
              <SuspendedScreen />
            </Suspense>
          ) : (
            <Outlet />
          )}
        </ErrorBoundary>
      </main>
      <PushHost />
      {isRoot && !suspended && <TabBar />}
    </div>
  );
}
