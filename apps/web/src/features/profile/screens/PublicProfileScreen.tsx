import { useQuery } from '@tanstack/react-query';
import { Link, useParams } from 'react-router';
import { getUser } from '@/api/account';
import { ApiError } from '@/api/client';
import { keys } from '@/api/keys';
import { useBack } from '@/app/useBack';
import { t, tp } from '@/i18n';
import { Avatar } from '@/ui/Avatar';
import { Button } from '@/ui/Button';
import { Notice } from '@/ui/Notice';
import { PageHeader } from '@/ui/PageHeader';

const monthFmt = new Intl.DateTimeFormat('en-GB', {
  month: 'long',
  year: 'numeric',
  timeZone: 'UTC',
});

/** `2026-11` -> `November 2026`. */
function formatMonth(ym: string): string {
  const d = new Date(`${ym}-01T00:00:00Z`);
  return Number.isNaN(d.getTime()) ? ym : monthFmt.format(d);
}

function Star() {
  return (
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
  );
}

/**
 * Screen 1.6: how others see a person. Phone, plate and surname never arrive from the API, and the page says so.
 * Rating shows only from 3 ratings (the API sends null below that). The report/block menu arrives with E5.
 */
export function PublicProfileScreen() {
  const { id = '' } = useParams();
  const back = useBack('/find');
  const q = useQuery({
    queryKey: keys.user(id),
    queryFn: ({ signal }) => getUser(id, signal),
    enabled: id.length > 0,
  });

  if (q.isPending)
    return (
      <>
        <PageHeader title={t('pub.title')} onBack={back} />
        <div role="status" className="flex flex-col items-center gap-4 p-6">
          <span className="sr-only">{t('a11y.loading')}</span>
          <div aria-hidden="true" className="skeleton size-20 rounded-full" />
          <div aria-hidden="true" className="skeleton h-6 w-40" />
          <div aria-hidden="true" className="skeleton h-24 w-full" />
        </div>
      </>
    );

  if (q.isError) {
    const gone = q.error instanceof ApiError && q.error.status === 404;
    return (
      <>
        <PageHeader title={gone ? t('pub.gone.title') : t('pub.title')} onBack={back} />
        <div className="flex flex-col gap-4 px-4 py-6">
          {gone ? (
            <p className="max-w-[40ch] text-text-muted">{t('pub.gone.body')}</p>
          ) : (
            <Notice tone="error">{t('error.generic')}</Notice>
          )}
          {gone ? (
            <Link
              to="/find"
              className="inline-flex min-h-12 items-center justify-center rounded-md bg-action px-5 py-3 font-semibold text-on-action no-underline hover:bg-action-hover"
            >
              {t('error.notFound.cta')}
            </Link>
          ) : (
            <Button variant="secondary" block onClick={() => void q.refetch()}>
              {t('common.retry')}
            </Button>
          )}
        </div>
      </>
    );
  }

  const u = q.data;
  const name = u.firstName ?? t('pub.deleted');
  const rating = u.rating;

  return (
    <>
      <PageHeader title={name} onBack={back} />
      <div className="flex flex-col gap-6 px-4 py-6">
        <div className="flex items-center gap-4">
          <Avatar name={u.firstName} photoUrl={u.photoUrl} size="lg" />
          <div className="flex min-w-0 flex-col gap-1">
            {rating ? (
              <p className="flex items-center gap-1.5 font-semibold">
                <Star />
                <span className="sr-only">
                  {t('a11y.rating', { r: rating.average.toFixed(1) })}.{' '}
                </span>
                <span>{t('pub.rating', { r: rating.average.toFixed(1), n: rating.count })}</span>
              </p>
            ) : (
              <p className="flex flex-col">
                <span className="inline-flex w-fit rounded-full bg-tint px-3 py-0.5 text-sm font-semibold text-on-tint">
                  {t('pub.new')}
                </span>
                <span className="mt-1 text-sm leading-5 text-text-muted">{t('pub.new.hint')}</span>
              </p>
            )}
            <p className="text-sm leading-5 text-text-muted">
              {t('pub.since', { month: formatMonth(u.memberSince) })}
            </p>
            <p className="text-sm leading-5 text-text-muted">{tp('pub.rides', u.ridesCompleted)}</p>
          </div>
        </div>

        <dl className="m-0 grid grid-cols-1 divide-y divide-border rounded-md border border-border bg-surface">
          <div className="flex items-center justify-between gap-3 px-4 py-3">
            <dt className="text-text-muted">{t('pub.late')}</dt>
            <dd className="m-0 font-semibold">{u.lateCancellations90d}</dd>
          </div>
          <div className="flex items-center justify-between gap-3 px-4 py-3">
            <dt className="text-text-muted">{t('pub.noShows')}</dt>
            <dd className="m-0 font-semibold">{u.noShows90d}</dd>
          </div>
        </dl>

        {u.bio && (
          <section aria-labelledby="pub-about" className="flex flex-col gap-1">
            <h2 id="pub-about" className="type-h3">
              {t('pub.about', { name })}
            </h2>
            <p className="max-w-[56ch] break-words whitespace-pre-line">{u.bio}</p>
          </section>
        )}

        <p className="text-sm leading-5 text-text-muted">{t('pub.private')}</p>
      </div>
    </>
  );
}
