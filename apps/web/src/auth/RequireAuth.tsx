import { useEffect, type ReactNode } from 'react';
import { Navigate, useLocation } from 'react-router';
import { t } from '@/i18n';
import { PageHeader } from '@/ui/PageHeader';
import { useAuth } from './AuthProvider';
import { saveIntent } from './intent';

/** Loading state shared by account screens: title, skeleton blocks and a screen-reader status. */
export function ScreenSkeleton({ title }: { title: string }) {
  return (
    <>
      <PageHeader title={title} />
      <div role="status" className="flex flex-col gap-4 p-4">
        <span className="sr-only">{t('a11y.loading')}</span>
        <div aria-hidden="true" className="skeleton h-20 w-20 rounded-full" />
        <div aria-hidden="true" className="skeleton h-12" />
        <div aria-hidden="true" className="skeleton h-12" />
        <div aria-hidden="true" className="skeleton h-24" />
      </div>
    </>
  );
}

/**
 * Account-only screens. Signed out: go to sign-in, and (unless this screen is itself an onboarding step) remember
 * this screen as the place to return to.
 */
export function RequireAuth({
  title,
  keepIntent,
  children,
}: {
  title: string;
  keepIntent?: boolean;
  children: ReactNode;
}) {
  const { status } = useAuth();
  const loc = useLocation();
  useEffect(() => {
    if (status === 'signedOut' && !keepIntent)
      saveIntent({ kind: 'other', returnTo: loc.pathname + loc.search });
  }, [status, keepIntent, loc.pathname, loc.search]);
  if (status === 'loading') return <ScreenSkeleton title={title} />;
  if (status === 'signedOut') return <Navigate to="/auth" replace />;
  return children;
}
