import { t } from '@/i18n';
import { EmptyState } from '@/ui/EmptyState';
import { Notice } from '@/ui/Notice';
import { PageHeader } from '@/ui/PageHeader';

// E0 placeholder: signed-out prompt. Riding/Driving lists land with E2 and E4.
export function RidesScreen() {
  return (
    <>
      <PageHeader title={t('rides.title')} />
      <EmptyState title={t('rides.visitor.title')} body={t('rides.visitor.body')}>
        <Notice tone="info">{t('me.signIn.soon')}</Notice>
      </EmptyState>
    </>
  );
}
