import { Link } from 'react-router';
import { useScreenHeading } from '@/app/useScreenHeading';
import { t } from '@/i18n';
import { TINY_ROUTE } from '@/ui/Loader';

export function NotFoundScreen() {
  const h1 = useScreenHeading(t('error.notFound.title'));
  return (
    <div className="empty py-16">
      <svg viewBox="0 0 160 70" className="empty-art" aria-hidden="true" focusable="false">
        <path className="tr" d={TINY_ROUTE} />
        <circle className="pt-b" cx="148" cy="12" r="5" />
        <circle className="pt-a breath" cx="12" cy="58" r="5" />
      </svg>
      <h1 ref={h1} tabIndex={-1} className="type-h2">
        {t('error.notFound.title')}
      </h1>
      <p className="max-w-[32ch] text-text-muted">{t('error.notFound.body')}</p>
      <Link to="/find" className="btn btn-primary">
        {t('error.notFound.cta')}
      </Link>
    </div>
  );
}
