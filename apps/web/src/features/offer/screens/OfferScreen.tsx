import { useAuth } from '@/auth/AuthProvider';
import { useGate, useMe } from '@/auth/hooks';
import { nextStep } from '@/auth/onboarding';
import { ScreenSkeleton } from '@/auth/RequireAuth';
import { t } from '@/i18n';
import { Button } from '@/ui/Button';
import { EmptyState } from '@/ui/EmptyState';
import { PageHeader } from '@/ui/PageHeader';
import { PublishForm } from '../components/PublishForm';

const OFFER = { kind: 'offer', returnTo: '/offer' } as const;

/**
 * Offer root. Gate (2.1): signed out or not set up (account, agreement, profile, car) explains the value and starts
 * onboarding with return-to-intent (ADR 0010); a missing car gets its own message. Ready: the publish form (2.2).
 */
export default function OfferScreen() {
  const { status } = useAuth();
  const me = useMe();
  const gate = useGate();

  if (status === 'loading' || (status === 'signedIn' && me.isPending))
    return <ScreenSkeleton title={t('offer.title')} />;

  const step = status === 'signedIn' && me.data ? nextStep(me.data, OFFER) : 'account';
  return (
    <>
      <PageHeader title={t('offer.title')} />
      {step === null ? (
        <PublishForm />
      ) : step === 'car' ? (
        <EmptyState title={t('offer.needCar.title')} body={t('offer.needCar.body')}>
          <Button onClick={() => gate(OFFER)}>{t('offer.needCar.cta')}</Button>
        </EmptyState>
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
