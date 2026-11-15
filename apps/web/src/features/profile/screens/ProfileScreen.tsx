import { t } from '@/i18n';
import { EmptyState } from '@/ui/EmptyState';
import { Notice } from '@/ui/Notice';
import { PageHeader } from '@/ui/PageHeader';

// E0 placeholder: signed-out prompt. Sign-in and the real profile land with E1.
export function ProfileScreen() {
  return (
    <>
      <PageHeader title={t('me.title')} />
      <EmptyState title={t('me.visitor.title')} body={t('me.visitor.body')}>
        <Notice tone="info">{t('me.signIn.soon')}</Notice>
      </EmptyState>
      {/* ODbL attribution for the OpenStreetMap-derived map tiles and gazetteer. */}
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
    </>
  );
}
