import { Link } from 'react-router';
import { useScreenHeading } from '@/app/useScreenHeading';
import { t } from '@/i18n';

export function NotFoundScreen() {
  const h1 = useScreenHeading(t('error.notFound.title'));
  return (
    <div className="flex flex-col items-center gap-3 px-6 py-16 text-center">
      <svg viewBox="0 0 120 80" aria-hidden="true" focusable="false" className="h-20 w-30">
        <path
          d="M10 68C34 68 40 40 62 36S98 28 110 10"
          fill="none"
          stroke="var(--color-primary-300)"
          strokeWidth="4"
          strokeLinecap="round"
          strokeDasharray="1 9"
        />
        <circle
          cx="110"
          cy="10"
          r="6"
          fill="var(--color-accent)"
          stroke="var(--color-primary-700)"
          strokeWidth="3"
        />
        <circle
          cx="10"
          cy="68"
          r="5"
          fill="var(--color-surface)"
          stroke="var(--color-primary-700)"
          strokeWidth="3"
        />
      </svg>
      <h1 ref={h1} tabIndex={-1} className="type-h2">
        {t('error.notFound.title')}
      </h1>
      <p className="max-w-[32ch] text-text-muted">{t('error.notFound.body')}</p>
      <Link
        to="/find"
        className="inline-flex min-h-12 items-center justify-center rounded-md bg-action px-5 py-3 font-semibold text-on-action no-underline hover:bg-action-hover"
      >
        {t('error.notFound.cta')}
      </Link>
    </div>
  );
}
