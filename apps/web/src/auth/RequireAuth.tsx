import { useEffect, type ReactNode } from 'react';
import { Navigate, useLocation } from 'react-router';
import { Loader } from '@/ui/Loader';
import { PageHeader } from '@/ui/PageHeader';
import { useAuth } from './AuthProvider';
import { saveIntent } from './intent';

/** Loading state shared by account screens: title plus the branded light on a tiny route (no spinner, no shimmer). */
export function ScreenSkeleton({ title }: { title: string }) {
  return (
    <>
      <PageHeader title={title} />
      <div aria-busy="true">
        <Loader />
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
