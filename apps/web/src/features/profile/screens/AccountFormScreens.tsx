import { useQuery } from '@tanstack/react-query';
import { useEffect, useRef } from 'react';
import { getVehicle } from '@/api/account';
import { ApiError } from '@/api/client';
import { keys } from '@/api/keys';
import { useAdvance, useMe } from '@/auth/hooks';
import { RequireAuth, ScreenSkeleton } from '@/auth/RequireAuth';
import { nextStep } from '@/auth/onboarding';
import { readIntent } from '@/auth/intent';
import { StepProgress } from '@/features/onboarding/StepProgress';
import { useBack } from '@/app/useBack';
import { t } from '@/i18n';
import { Button } from '@/ui/Button';
import { Notice } from '@/ui/Notice';
import { PageHeader } from '@/ui/PageHeader';
import { ProfileForm } from '../components/ProfileForm';
import { VehicleForm } from '../components/VehicleForm';

/** `GET /me/vehicle` is 404 when there is no car yet: that is a normal state, not an error. */
function useVehicle(enabled: boolean) {
  return useQuery({
    queryKey: keys.vehicle,
    enabled,
    queryFn: async ({ signal }) => {
      try {
        return await getVehicle(signal);
      } catch (e) {
        if (e instanceof ApiError && e.status === 404) return null;
        throw e;
      }
    },
  });
}

function LoadError({ title, onRetry }: { title: string; onRetry: () => void }) {
  return (
    <>
      <PageHeader title={title} />
      <div className="flex flex-col gap-4 p-4">
        <Notice tone="error">{t('me.loadError')}</Notice>
        <Button variant="secondary" block onClick={onRetry}>
          {t('common.retry')}
        </Button>
      </div>
    </>
  );
}

/** Screen 1.4, onboarding step 3: profile setup. Skips ahead when the profile is already complete. */
export function ProfileSetupScreen() {
  const me = useMe();
  const advance = useAdvance();
  // Judge only what was there on arrival: after our own save, the form's submit handler does the advancing.
  const arrived = useRef(false);
  useEffect(() => {
    if (!me.data || arrived.current) return;
    arrived.current = true;
    // Consent first, and nothing to do when the profile is already complete.
    if (nextStep(me.data, readIntent()) !== 'profile') void advance(me.data);
  }, [me.data, advance]);
  return (
    <RequireAuth title={t('setup.profile.title')} keepIntent>
      {me.isError ? (
        <LoadError title={t('setup.profile.title')} onRetry={() => void me.refetch()} />
      ) : !me.data || nextStep(me.data, readIntent()) !== 'profile' ? (
        <ScreenSkeleton title={t('setup.profile.title')} />
      ) : (
        <>
          <PageHeader title={t('setup.profile.title')} />
          <div className="flex flex-col gap-5 px-4 py-5">
            <StepProgress current="profile" />
            <p className="max-w-[44ch]">{t('setup.profile.body')}</p>
            <ProfileForm me={me.data} mode="setup" />
          </div>
        </>
      )}
    </RequireAuth>
  );
}

/** Edit profile (same form as onboarding, ia-and-flows F9). */
export function EditProfileScreen() {
  const me = useMe();
  const back = useBack('/profile');
  return (
    <RequireAuth title={t('profile.edit.title')}>
      {me.isError ? (
        <LoadError title={t('profile.edit.title')} onRetry={() => void me.refetch()} />
      ) : !me.data ? (
        <ScreenSkeleton title={t('profile.edit.title')} />
      ) : (
        <>
          <PageHeader title={t('profile.edit.title')} onBack={back} />
          <div className="px-4 py-5">
            <ProfileForm me={me.data} mode="edit" />
          </div>
        </>
      )}
    </RequireAuth>
  );
}

function VehicleScreenBody({ mode }: { mode: 'setup' | 'edit' }) {
  const me = useMe();
  const vehicle = useVehicle(Boolean(me.data));
  const back = useBack('/profile');
  const title = t('vehicle.title');
  if (me.isError || vehicle.isError)
    return (
      <LoadError
        title={title}
        onRetry={() => void (me.isError ? me.refetch() : vehicle.refetch())}
      />
    );
  if (!me.data || vehicle.isPending) return <ScreenSkeleton title={title} />;
  return (
    <>
      <PageHeader title={title} onBack={mode === 'edit' ? back : undefined} />
      <div className="flex flex-col gap-5 px-4 py-5">
        {mode === 'setup' && <StepProgress current="car" />}
        <p className="max-w-[44ch]">{t('vehicle.body')}</p>
        <VehicleForm vehicle={vehicle.data ?? null} mode={mode} />
      </div>
    </>
  );
}

/** Screen 1.5: `/setup/vehicle` (step 4 for drivers) and `/profile/car` (edit). */
export function VehicleScreen({ mode }: { mode: 'setup' | 'edit' }) {
  return (
    <RequireAuth title={t('vehicle.title')} keepIntent={mode === 'setup'}>
      <VehicleScreenBody mode={mode} />
    </RequireAuth>
  );
}
