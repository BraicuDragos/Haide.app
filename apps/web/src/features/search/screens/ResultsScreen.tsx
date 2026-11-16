import { useQuery } from '@tanstack/react-query';
import { useMemo } from 'react';
import { Link, Navigate } from 'react-router';
import { ApiError } from '@/api/client';
import { keys } from '@/api/keys';
import { postSearch } from '@/api/search';
import type { SearchResultItem } from '@/api/types';
import { useBack } from '@/app/useBack';
import { t, tError, tp } from '@/i18n';
import { bucharestToIso, dayLabel } from '@/lib/dates';
import { Button } from '@/ui/Button';
import { EmptyState } from '@/ui/EmptyState';
import { Icon } from '@/ui/Icon';
import { Loader } from '@/ui/Loader';
import { Notice } from '@/ui/Notice';
import { PageHeader } from '@/ui/PageHeader';
import { readSearch, toRequest, type SearchCriteria } from '@/features/find/searchState';
import { ResultCard } from '../components/ResultCard';

const WINDOW_KEY = {
  '15': 'find.window.15',
  '30': 'find.window.30',
  '60': 'find.window.60',
} as const;

/** Results (3.2): ranked rides for the saved search. Works signed out (E3-4). */
export default function ResultsScreen() {
  const criteria = useMemo(readSearch, []);
  if (!criteria) return <Navigate to="/find" replace />;
  return <Results criteria={criteria} />;
}

function Results({ criteria }: { criteria: SearchCriteria }) {
  const back = useBack('/find');
  const body = useMemo(() => toRequest(criteria), [criteria]);
  const q = useQuery({
    queryKey: keys.search(body),
    queryFn: ({ signal }) => postSearch(body, signal),
  });

  const count = q.data?.items.length ?? 0;
  const title = q.isPending
    ? t('results.title.loading')
    : q.isError
      ? t('results.error.title')
      : count === 0
        ? t('results.title.empty')
        : tp('results.count', count);

  return (
    <>
      <PageHeader title={title} onBack={back} />
      <div className="flex flex-col gap-4 px-4 pt-4 pb-6" aria-busy={q.isPending || undefined}>
        <Summary criteria={criteria} />
        {q.isPending && <Loader label={t('results.loading')} />}
        {q.isError && <ErrorBlock error={q.error} onRetry={() => void q.refetch()} />}
        {q.data && count > 0 && (
          <>
            <p className="text-sm leading-5 text-text-muted">{t('results.sortNote')}</p>
            <ul aria-label={t('results.list')} className="m-0 flex list-none flex-col gap-3 p-0">
              {q.data.items.map((item) => (
                <li key={item.rideId}>
                  <ResultCard item={item} />
                </li>
              ))}
            </ul>
          </>
        )}
        {q.data && count === 0 && (
          <Empty criteria={criteria} nearest={q.data.nearestOutsideWindow ?? []} />
        )}
        {q.data && (q.data.hiddenBlockedCount ?? 0) > 0 && (
          <Notice tone="info">{t('results.blockedNote')}</Notice>
        )}
      </div>
    </>
  );
}

/** "Șelimbăr to Zona Industrială Vest", "Today, 07:30, ±30 min" and the way back to the form. */
function Summary({ criteria }: { criteria: SearchCriteria }) {
  const when = t('results.when', {
    day: dayLabel(bucharestToIso(criteria.day, criteria.time)),
    time: criteria.time,
    win: t(WINDOW_KEY[criteria.win]),
  });
  return (
    <section
      aria-label={t('find.title')}
      className="card flex items-center justify-between gap-3 p-4"
    >
      <div className="min-w-0">
        <p className="font-semibold">
          {t('results.route', { from: criteria.from.name, to: criteria.to.name })}
        </p>
        <p className="text-sm leading-5 text-text-muted">{when}</p>
      </div>
      <Link to="/find" className="btn btn-tonal flex-none">
        {t('results.editSearch')}
      </Link>
    </section>
  );
}

function ErrorBlock({ error, onRetry }: { error: unknown; onRetry: () => void }) {
  const offline = error instanceof ApiError && error.code === 'NETWORK';
  const known = error instanceof ApiError && !offline && error.code !== 'UNKNOWN';
  return (
    <div className="flex flex-col items-start gap-3">
      <Notice tone="error">
        <strong className="block">{t('results.error.title')}</strong>
        {known ? tError(error.code) : t('results.error')}
      </Notice>
      <Button variant="secondary" icon={<Icon name="route" />} onClick={onRetry}>
        {t('results.retry')}
      </Button>
    </div>
  );
}

/** Zero results is never a dead end (E3-5): nearest rides the same day, a way back to the form, and the E8 slot. */
function Empty({ criteria, nearest }: { criteria: SearchCriteria; nearest: SearchResultItem[] }) {
  const desired = new Date(bucharestToIso(criteria.day, criteria.time)).getTime();
  return (
    <>
      <EmptyState title={t('results.empty.title')} body={t('results.empty.body')}>
        <div className="flex w-full max-w-xs flex-col gap-2">
          <Button disabled aria-describedby="notify-soon">
            {t('results.empty.notify')}
          </Button>
          <p id="notify-soon" className="text-sm leading-5 text-text-muted">
            {t('results.notify.soon')}
          </p>
          <Link to="/find" className="btn btn-secondary">
            {t('results.empty.edit')}
          </Link>
        </div>
      </EmptyState>
      {nearest.length > 0 && (
        <section aria-labelledby="near-h" className="flex flex-col gap-3">
          <h2 id="near-h" className="type-h3">
            {t('results.empty.alt')}
          </h2>
          <ul className="m-0 flex list-none flex-col gap-3 p-0">
            {nearest.map((item) => (
              <li key={item.rideId}>
                <ResultCard
                  item={item}
                  outsideMin={Math.round(
                    Math.abs(new Date(item.departureAt).getTime() - desired) / 60_000,
                  )}
                />
              </li>
            ))}
          </ul>
        </section>
      )}
    </>
  );
}
