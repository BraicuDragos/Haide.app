import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Link, useParams } from 'react-router';
import { getBooking } from '@/api/bookings';
import { ApiError } from '@/api/client';
import { keys } from '@/api/keys';
import { postRating } from '@/api/safety';
import type { BookingView, RatingTag } from '@/api/types';
import { useBack } from '@/app/useBack';
import { RequireAuth } from '@/auth/RequireAuth';
import { invalidateAfterSafety } from '@/features/safety/invalidate';
import { t, tError } from '@/i18n';
import { whenLabel } from '@/lib/booking';
import { Button } from '@/ui/Button';
import { EmptyState } from '@/ui/EmptyState';
import { Icon } from '@/ui/Icon';
import { Loader } from '@/ui/Loader';
import { Notice } from '@/ui/Notice';
import { PageHeader } from '@/ui/PageHeader';
import { useToast } from '@/ui/Toast';
import { StarInput } from '../StarInput';
import { RATING_TAGS, TAG_LABEL } from '../tags';

/** Rate (5.1): stars, optional tags for the other person's role, and a clear note that ratings are blind. */
export default function RateScreen() {
  return (
    <RequireAuth title={t('rate.title', { name: '' }).trim()}>
      <Rate />
    </RequireAuth>
  );
}

function Rate() {
  const { bookingId = '' } = useParams();
  const q = useQuery({
    queryKey: keys.bookings.one(bookingId),
    queryFn: ({ signal }) => getBooking(bookingId, signal),
    enabled: bookingId.length > 0,
    retry: (n, err) => !(err instanceof ApiError && err.status === 404) && n < 1,
  });
  // Driver: back to the ride they are on. Passenger: back to My rides.
  const fallback = q.data
    ? q.data.viewerRole === 'driver'
      ? `/driving/${q.data.rideId}`
      : '/rides'
    : '/rides';
  const back = useBack(fallback);

  if (q.isPending)
    return (
      <>
        <PageHeader title={t('rate.title', { name: '' }).trim()} onBack={back} />
        <div aria-busy="true">
          <Loader label={t('rate.loading')} />
        </div>
      </>
    );
  if (q.isError || !q.data) {
    const gone = q.error instanceof ApiError && q.error.status === 404;
    return (
      <>
        <PageHeader title={t('rate.title', { name: '' }).trim()} onBack={back} />
        {gone ? (
          <EmptyState title={t('errors.NOT_FOUND')} body="">
            <Link to="/rides" className="btn btn-primary">
              {t('rate.back')}
            </Link>
          </EmptyState>
        ) : (
          <div className="flex flex-col items-start gap-3 p-4">
            <Notice tone="error">
              {q.error instanceof ApiError && q.error.code !== 'NETWORK'
                ? tError(q.error.code)
                : t('booking.err')}
            </Notice>
            <Button variant="secondary" onClick={() => void q.refetch()}>
              {t('common.retry')}
            </Button>
          </div>
        )}
      </>
    );
  }
  return <RateForm booking={q.data} back={back} />;
}

function RateForm({ booking: b, back }: { booking: BookingView; back: () => void }) {
  const qc = useQueryClient();
  const toast = useToast();
  const counterpart = b.viewerRole === 'driver' ? b.passenger : b.driver;
  const name = counterpart.firstName ?? t('pub.deleted');
  const tags = RATING_TAGS[b.viewerRole === 'driver' ? 'passenger' : 'driver'];
  const doneTo = b.viewerRole === 'driver' ? '/rides?role=driving&when=past' : '/rides?when=past';

  const [stars, setStars] = useState(0);
  const [picked, setPicked] = useState<RatingTag[]>([]);
  const [problem, setProblem] = useState<string | null>(null);
  const [error, setError] = useState<{ code: string; text: string } | null>(null);
  const [done, setDone] = useState(false);

  const send = useMutation({
    mutationFn: () => postRating(b.id, { stars, tags: picked }),
    onSuccess: (given) => {
      qc.setQueryData<BookingView>(keys.bookings.one(b.id), (old) =>
        old ? { ...old, rating: { given, rateUntil: old.rating?.rateUntil ?? null } } : old,
      );
      invalidateAfterSafety(qc, { bookingId: b.id, rideId: b.rideId });
      toast.show(t('rate.toast'));
      setDone(true);
    },
    onError: (err) => {
      const code = err instanceof ApiError ? err.code : 'NETWORK';
      setError({ code, text: tError(code) });
      // Somebody else got there first (a double tap, a second device): show the real state.
      if (['ALREADY_RATED', 'WINDOW_CLOSED', 'INVALID_STATE'].includes(code))
        invalidateAfterSafety(qc, { bookingId: b.id, rideId: b.rideId });
    },
  });

  const header = <PageHeader title={t('rate.title', { name })} onBack={back} />;

  if (done)
    return (
      <>
        {header}
        <div className="flex flex-col items-center gap-4 px-6 pt-12 pb-8 text-center">
          <span className="pop-in grid size-20 place-items-center rounded-full bg-tint text-savings">
            <Icon name="done" className="size-10" />
          </span>
          <div role="status" className="flex flex-col items-center gap-4">
            <h2 className="type-h2">{t('rate.done.title')}</h2>
            <p className="max-w-[32ch] text-text-muted">{t('rate.done.body', { name })}</p>
          </div>
          <Link to={doneTo} replace className="btn btn-primary mt-2">
            {t('rate.done.cta')}
          </Link>
        </div>
      </>
    );

  const given = b.rating?.given ?? null;
  if (given)
    return (
      <>
        {header}
        <div className="flex flex-col items-start gap-4 p-4">
          <Notice tone="success">{t('rate.already', { name })}</Notice>
          <Link to={doneTo} replace className="btn btn-secondary">
            {t('rate.back')}
          </Link>
        </div>
      </>
    );

  if (!b.actions.canRate)
    return (
      <>
        {header}
        <div className="flex flex-col items-start gap-4 p-4">
          <Notice tone="error">
            {b.rating?.rateUntil && Date.parse(b.rating.rateUntil) <= Date.now()
              ? tError('WINDOW_CLOSED')
              : tError('INVALID_STATE')}
          </Notice>
          <Link to={doneTo} replace className="btn btn-secondary">
            {t('rate.back')}
          </Link>
        </div>
      </>
    );

  const terminal =
    error && ['ALREADY_RATED', 'WINDOW_CLOSED', 'INVALID_STATE'].includes(error.code);

  return (
    <>
      {header}
      <form
        noValidate
        className="flex flex-1 flex-col"
        onSubmit={(e) => {
          e.preventDefault();
          if (stars < 1) {
            setProblem(t('rate.err'));
            return;
          }
          setProblem(null);
          setError(null);
          send.mutate();
        }}
      >
        <div className="flex flex-col gap-6 px-4 pt-6 pb-6">
          <StarInput
            legend={t('rate.stars')}
            value={stars}
            error={problem ?? undefined}
            onChange={(n) => {
              setStars(n);
              setProblem(null);
            }}
          />
          <fieldset className="m-0 flex min-w-0 flex-col gap-2 border-0 p-0">
            <legend className="type-label mb-1 p-0">
              {t('rate.tags')}{' '}
              <span className="font-normal text-text-muted">({t('common.optional')})</span>
            </legend>
            <div className="flex flex-wrap gap-2">
              {tags.map((tag) => {
                const on = picked.includes(tag);
                return (
                  <button
                    key={tag}
                    type="button"
                    aria-pressed={on}
                    className="chip"
                    onClick={() =>
                      setPicked((cur) => (on ? cur.filter((x) => x !== tag) : [...cur, tag]))
                    }
                  >
                    {on && <Icon name="check" small />}
                    {t(TAG_LABEL[tag])}
                  </button>
                );
              })}
            </div>
          </fieldset>
          <p className="text-sm leading-5 text-text-muted">
            {t('rate.window')}
            {b.rating?.rateUntil && (
              <> {t('rate.until', { when: whenLabel(b.rating.rateUntil) })}</>
            )}
          </p>
          {error && (
            <Notice tone="error">
              <span>{error.text}</span>
              {terminal && (
                <>
                  {' '}
                  <Link to={doneTo} replace className="font-semibold">
                    {t('rate.back')}
                  </Link>
                </>
              )}
            </Notice>
          )}
        </div>
        <div className="sticky bottom-0 mt-auto border-t border-(color:--hair) bg-bg p-4 pb-[calc(1rem+env(safe-area-inset-bottom))]">
          <Button type="submit" block loading={send.isPending}>
            {t('rate.submit')}
          </Button>
        </div>
      </form>
    </>
  );
}
