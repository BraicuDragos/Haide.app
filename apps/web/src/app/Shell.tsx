import { useEffect, useState } from 'react';
import { Outlet, useLocation } from 'react-router';
import { t } from '@/i18n';
import { Icon } from '@/ui/Icon';
import { ErrorBoundary } from './ErrorBoundary';
import { TabBar, TABS } from './TabBar';
import { useNavigationCounter } from './useScreenHeading';

/** Known route templates only: raw URLs never go to telemetry (conventions section 6). */
export function routeTemplate(pathname: string): string {
  return TABS.some((tab) => tab.to === pathname) ? pathname : '/:other';
}

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
  const isRoot = TABS.some((tab) => tab.to === loc.pathname);

  return (
    <div className="mx-auto flex min-h-dvh w-full max-w-xl flex-col bg-bg md:border-x md:border-(color:--hair)">
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
          <Outlet />
        </ErrorBoundary>
      </main>
      {isRoot && <TabBar />}
    </div>
  );
}
