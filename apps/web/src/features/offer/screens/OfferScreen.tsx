import { t } from '@/i18n';
import { EmptyState } from '@/ui/EmptyState';
import { PageHeader } from '@/ui/PageHeader';

// E0 placeholder: the publish form lands with E2. Signed-out behaviour per ia-and-flows 2.1: explain the value.
export function OfferScreen() {
  return (
    <>
      <PageHeader title={t('offer.title')} />
      <EmptyState title={t('offer.soon.title')} body={t('offer.soon.body')} />
    </>
  );
}
