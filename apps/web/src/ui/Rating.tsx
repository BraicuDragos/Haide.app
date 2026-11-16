import { t } from '@/i18n';

/** Star, average and count ("4.8 (23)"), or "New to Haide" below 3 ratings (the API sends null then). */
export function Rating({ rating }: { rating: { average: number; count: number } | null }) {
  if (!rating) return <span className="text-sm leading-5 text-text-muted">{t('pub.new')}</span>;
  return (
    <span className="inline-flex items-center gap-1 text-sm leading-5 text-text-muted">
      <svg
        viewBox="0 0 24 24"
        aria-hidden="true"
        focusable="false"
        className="size-4 flex-none text-warning"
      >
        <path
          fill="currentColor"
          d="M12 3l2.6 5.6 6.1.7-4.5 4.2 1.2 6L12 16.5 6.6 19.5l1.2-6L3.3 9.3l6.1-.7z"
        />
      </svg>
      <span aria-hidden="true">
        {rating.average.toFixed(1)} ({rating.count})
      </span>
      <span className="sr-only">
        {t('card.rating', { r: rating.average.toFixed(1), n: rating.count })}
      </span>
    </span>
  );
}
