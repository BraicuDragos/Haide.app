import { useAuth } from '@/auth/AuthProvider';
import { useStartAuth } from '@/auth/hooks';
import { t } from '@/i18n';
import { Button } from '@/ui/Button';
import { EmptyState } from '@/ui/EmptyState';
import { PageHeader } from '@/ui/PageHeader';

// Riding/Driving lists land with E2 and E4. Signed out: sign-in prompt in place (ia-and-flows 2.1).
export function RidesScreen() {
  const { status } = useAuth();
  const startAuth = useStartAuth();
  return (
    <>
      <PageHeader title={t('rides.title')} />
      <EmptyState title={t('rides.visitor.title')} body={t('rides.visitor.body')}>
        {status !== 'signedIn' && (
          <Button onClick={() => startAuth({ kind: 'other', returnTo: '/rides' })}>
            {t('rides.visitor.cta')}
          </Button>
        )}
      </EmptyState>
    </>
  );
}
