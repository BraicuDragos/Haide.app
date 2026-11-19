import { useQuery } from '@tanstack/react-query';
import { lazy, Suspense, type ReactNode } from 'react';
import { Link } from 'react-router';
import { getVehicle } from '@/api/account';
import { getMonthStats } from '@/api/liquidity';
import { ApiError } from '@/api/client';
import { keys } from '@/api/keys';
import { useAuth } from '@/auth/AuthProvider';
import { useMe, useSignOut, useStartAuth } from '@/auth/hooks';
import { saveIntent } from '@/auth/intent';
import { nextStep, STEP_PATH } from '@/auth/onboarding';
import { ScreenSkeleton } from '@/auth/RequireAuth';
import { PrivacyRows } from '@/features/privacy/PrivacyRows';
import { t } from '@/i18n';
import { formatRon } from '@/lib/format';
import { Avatar } from '@/ui/Avatar';
import { Button } from '@/ui/Button';
import { EmptyState } from '@/ui/EmptyState';
import { Icon, type IconName } from '@/ui/Icon';
import { Notice } from '@/ui/Notice';
import { PageHeader } from '@/ui/PageHeader';
import { DisplaySettings } from '../components/DisplaySettings';

function Row({
  to,
  icon,
  label,
  value,
}: {
  to: string;
  icon: IconName;
  label: string;
  value?: string;
}) {
  return (
    <li>
      <Link
        to={to}
        className="flex min-h-14 items-center gap-3 px-4 py-2 text-text no-underline hover:bg-surface-subtle"
      >
        <Icon name={icon} className="text-link" />
        <span className="flex min-w-0 flex-1 flex-col">
          <span className="font-semibold">{label}</span>
          {value && <span className="text-sm leading-5 text-text-muted">{value}</span>}
        </span>
        <Icon name="chev" small className="text-text-muted" />
      </Link>
    </li>
  );
}

// The push switch brings its own code: it loads with the Settings screen, never with the entry chunk.
const PushSettings = lazy(() => import('@/features/push/PushSettings'));

/** Notifications group (E8): ride alerts, and the push switch when this browser and the server support it. */
function NotificationRows() {
  return (
    <section aria-labelledby="notif-heading" className="flex flex-col gap-1">
      <h2 id="notif-heading" className="type-h3 px-4">
        {t('settings.notifications')}
      </h2>
      <ul className="group mx-4">
        <Row
          to="/settings/alerts"
          icon="clock"
          label={t('settings.alerts')}
          value={t('settings.alerts.value')}
        />
        <Suspense fallback={null}>
          <PushSettings />
        </Suspense>
      </ul>
    </section>
  );
}

/** One line for the month (E8-5): what the driver shared of fuel costs, else what the passenger paid. Nothing at zero. */
function MonthLine() {
  const q = useQuery({
    queryKey: keys.monthStats,
    queryFn: ({ signal }) => getMonthStats(signal),
    staleTime: 60_000,
    retry: false,
  });
  const d = q.data?.driver.sharedFuelCostBani ?? 0;
  const p = q.data?.passenger.paidBani ?? 0;
  if (d > 0)
    return (
      <p className="px-4 font-semibold text-savings">
        {t('profile.month.driver', { amount: formatRon(d) })}
      </p>
    );
  if (p > 0)
    return (
      <p className="px-4 font-semibold text-savings">
        {t('profile.month.passenger', { amount: formatRon(p) })}
      </p>
    );
  return null;
}

function PolicyRows({ children }: { children?: ReactNode }) {
  return (
    <section aria-labelledby="privacy-heading" className="flex flex-col gap-1">
      <h2 id="privacy-heading" className="type-h3 px-4">
        {t('me.privacy')}
      </h2>
      <ul className="group mx-4">
        <Row to="/policy/privacy" icon="doc" label={t('settings.policy')} />
        <Row to="/policy/terms" icon="doc" label={t('settings.terms')} />
        {children}
      </ul>
    </section>
  );
}

/** Safety group (6.3): blocked people, with unblock on the next screen. */
function SafetyRows() {
  return (
    <section aria-labelledby="safety-heading" className="flex flex-col gap-1">
      <h2 id="safety-heading" className="type-h3 px-4">
        {t('settings.safety')}
      </h2>
      <ul className="group mx-4">
        <Row to="/settings/blocked" icon="shield" label={t('settings.blocked')} />
      </ul>
    </section>
  );
}

/** Admin entry (E7): only rendered for role admin. The routes and the API check the role again. */
function AdminRows() {
  return (
    <section aria-labelledby="admin-heading" className="flex flex-col gap-1">
      <h2 id="admin-heading" className="type-h3 px-4">
        {t('settings.admin')}
      </h2>
      <ul className="group mx-4">
        <Row to="/admin" icon="shield" label={t('settings.admin.open')} />
      </ul>
    </section>
  );
}

/** ODbL attribution for the OpenStreetMap-derived map tiles and gazetteer. */
function About() {
  return (
    <section aria-labelledby="about-heading" className="flex flex-col gap-2 px-4 pb-8">
      <h2 id="about-heading" className="type-h3">
        {t('me.about.title')}
      </h2>
      <p className="text-sm leading-5 text-text-muted">{t('me.about.osm')}</p>
      <a
        href="https://www.openstreetmap.org/copyright"
        target="_blank"
        rel="noopener noreferrer"
        className="inline-flex min-h-12 items-center text-sm font-semibold text-action underline"
      >
        {t('me.about.osmLink')}
      </a>
    </section>
  );
}

function SignedOut() {
  const startAuth = useStartAuth();
  return (
    <>
      <PageHeader title={t('me.title')} />
      <EmptyState title={t('me.visitor.title')} body={t('me.visitor.body')}>
        <Button onClick={() => startAuth({ kind: 'other', returnTo: '/profile' })}>
          {t('me.visitor.cta')}
        </Button>
      </EmptyState>
      <div className="flex flex-col gap-6 pb-4">
        <DisplaySettings />
        <PolicyRows />
        <About />
      </div>
    </>
  );
}

function SignedIn() {
  const me = useMe();
  const signOut = useSignOut();
  const vehicle = useQuery({
    queryKey: keys.vehicle,
    enabled: me.data?.hasVehicle === true,
    queryFn: async ({ signal }) => {
      try {
        return await getVehicle(signal);
      } catch (e) {
        if (e instanceof ApiError && e.status === 404) return null;
        throw e;
      }
    },
  });

  if (me.isPending) return <ScreenSkeleton title={t('me.title')} />;
  if (me.isError)
    return (
      <>
        <PageHeader title={t('me.title')} />
        <div className="flex flex-col gap-4 p-4">
          <Notice tone="error">{t('me.loadError')}</Notice>
          <Button variant="secondary" block onClick={() => void me.refetch()}>
            {t('common.retry')}
          </Button>
        </div>
        <div className="pt-2">
          <Button variant="ghost" block onClick={() => void signOut()}>
            {t('me.signOut')}
          </Button>
        </div>
      </>
    );

  const u = me.data;
  // Terms bumped or onboarding left half-done: offer the next missing step (passenger steps; the car belongs to Offer).
  const step = nextStep(u, { kind: 'other', returnTo: '/profile' });
  const setupPath = step ? STEP_PATH[step] : null;
  const car = vehicle.data
    ? `${vehicle.data.make} ${vehicle.data.model}, ${vehicle.data.colour}`
    : undefined;

  return (
    <>
      <PageHeader title={t('me.title')} />
      <div className="flex flex-col gap-6 pt-5">
        <div className="flex items-center gap-4 px-4">
          <Avatar name={u.firstName ?? u.email} photoUrl={u.photoUrl} size="lg" />
          <div className="flex min-w-0 flex-col">
            <p className="type-h2 break-words">{u.firstName ?? u.email}</p>
            {u.firstName && (
              <p className="text-sm leading-5 break-all text-text-muted">{u.email}</p>
            )}
          </div>
        </div>

        <MonthLine />

        {setupPath && (
          <div className="card mx-4 flex flex-col gap-3 p-4">
            <h2 className="type-h3">{t('me.setup.title')}</h2>
            <p className="text-text-muted">{t('me.setup.body')}</p>
            <Link
              to={setupPath}
              onClick={() => saveIntent({ kind: 'other', returnTo: '/profile' })}
              className="btn btn-primary"
            >
              {t('me.setup.cta')}
            </Link>
          </div>
        )}

        <ul className="group mx-4">
          <Row to={`/user/${u.id}`} icon="user" label={t('me.viewPublic')} />
          <Row to="/profile/edit" icon="rides" label={t('me.edit')} />
          <Row
            to="/profile/car"
            icon="car"
            label={t('me.car')}
            value={u.hasVehicle ? car : t('me.car.none')}
          />
        </ul>

        <DisplaySettings />

        <NotificationRows />

        <SafetyRows />

        {u.role === 'admin' && <AdminRows />}

        <PolicyRows>
          <PrivacyRows />
        </PolicyRows>

        <div className="px-4">
          <Button variant="secondary" block onClick={() => void signOut()}>
            {t('me.signOut')}
          </Button>
        </div>
        <About />
      </div>
    </>
  );
}

/** Screen 1.7: own profile hub; signed out it is the join card. Policies stay reachable signed out (E6-3). */
export function ProfileScreen() {
  const { status } = useAuth();
  if (status === 'loading') return <ScreenSkeleton title={t('me.title')} />;
  return status === 'signedIn' ? <SignedIn /> : <SignedOut />;
}
