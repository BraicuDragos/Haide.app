import { useAuth } from '@/auth/AuthProvider';
import { useGate, useMe } from '@/auth/hooks';
import { nextStep } from '@/auth/onboarding';
import { ScreenSkeleton } from '@/auth/RequireAuth';
import { t } from '@/i18n';
import { Button } from '@/ui/Button';
import { EmptyState } from '@/ui/EmptyState';
import { PageHeader } from '@/ui/PageHeader';

const OFFER = { kind: 'offer', returnTo: '/offer' } as const;

/**
 * Offer root. Signed out or not set up (account, agreement, profile, car): explains the value and starts onboarding
 * with return-to-intent (ADR 0010). The publish form itself lands with E2.
 */
export function OfferScreen() {
  const { status } = useAuth();
  const me = useMe();
  const gate = useGate();

  if (status === 'loading' || (status === 'signedIn' && me.isPending))
    return <ScreenSkeleton title={t('offer.title')} />;

  const ready = status === 'signedIn' && me.data && !nextStep(me.data, OFFER);
  return (
    <>
      <PageHeader title={t('offer.title')} />
      {ready ? (
        <EmptyState title={t('offer.soon.title')} body={t('offer.soon.body')} />
      ) : (
        <EmptyState title={t('offer.gate.title')} body={t('offer.gate.body')}>
          <Button onClick={() => gate(OFFER)}>
            {status === 'signedIn' ? t('me.setup.cta') : t('me.visitor.cta')}
          </Button>
        </EmptyState>
      )}
    </>
  );
}
