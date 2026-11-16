import { useInfiniteQuery } from '@tanstack/react-query';
import { Link, useSearchParams } from 'react-router';
import { ApiError } from '@/api/client';
import { keys } from '@/api/keys';
import { getMyBookings } from '@/api/bookings';
import { getMyRides } from '@/api/rides';
import { useAuth } from '@/auth/AuthProvider';
import { useStartAuth } from '@/auth/hooks';
import { ScreenSkeleton } from '@/auth/RequireAuth';
import { BookingCard } from '@/features/bookings/components/BookingCard';
import { t, tError } from '@/i18n';
import { Button } from '@/ui/Button';
import { EmptyState } from '@/ui/EmptyState';
import { Loader } from '@/ui/Loader';
import { Notice } from '@/ui/Notice';
import { PageHeader } from '@/ui/PageHeader';
import { RideCard } from '../components/RideCard';
import { SegTabs, tabId } from '../components/SegTabs';

type Role = 'riding' | 'driving';
type When = 'upcoming' | 'past';

/**
 * My rides. Signed out: sign-in prompt in place (ia-and-flows 2.1). Signed in: Riding or Driving, then Upcoming or
 * Past. Driving is the E2 list (2.5); Riding is the E4 list of my bookings (4.4). The tab choice
 * lives in the URL so Back from a ride returns to the same list.
 */
export default function RidesScreen() {
  const { status } = useAuth();
  const startAuth = useStartAuth();
  const [sp, setSp] = useSearchParams();
  const role: Role = sp.get('role') === 'driving' ? 'driving' : 'riding';
  const when: When = sp.get('when') === 'past' ? 'past' : 'upcoming';
  const set = (next: Partial<Record<'role' | 'when', string>>) => {
    const p = new URLSearchParams(sp);
    for (const [k, v] of Object.entries(next)) p.set(k, v);
    setSp(p, { replace: true });
  };

  if (status === 'loading') return <ScreenSkeleton title={t('rides.title')} />;
  if (status !== 'signedIn')
    return (
      <>
        <PageHeader title={t('rides.title')} />
        <EmptyState title={t('rides.visitor.title')} body={t('rides.visitor.body')}>
          <Button onClick={() => startAuth({ kind: 'other', returnTo: '/rides' })}>
            {t('rides.visitor.cta')}
          </Button>
        </EmptyState>
      </>
    );

  return (
    <>
      <PageHeader title={t('rides.title')} />
      <div className="flex flex-col gap-4 px-4 pt-4 pb-6">
        <SegTabs<Role>
          prefix="role"
          label={t('rides.tabs.role')}
          value={role}
          onChange={(v) => set({ role: v })}
          tabs={[
            { value: 'riding', label: t('rides.riding') },
            { value: 'driving', label: t('rides.driving') },
          ]}
        />
        <SegTabs<When>
          prefix="when"
          label={t('rides.tabs.when')}
          value={when}
          onChange={(v) => set({ when: v })}
          tabs={[
            { value: 'upcoming', label: t('rides.upcoming') },
            { value: 'past', label: t('rides.past') },
          ]}
        />
        <div role="tabpanel" aria-labelledby={tabId('role', role)}>
          {role === 'driving' ? <DrivingList when={when} /> : <RidingList when={when} />}
        </div>
      </div>
    </>
  );
}

function DrivingList({ when }: { when: When }) {
  const q = useInfiniteQuery({
    queryKey: keys.rides.list(when),
    queryFn: ({ pageParam, signal }) => getMyRides(when, pageParam, signal),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.nextCursor ?? undefined,
  });

  if (q.isPending)
    return (
      <div aria-busy="true">
        <Loader label={t('rides.loading')} />
      </div>
    );
  if (q.isError)
    return (
      <div className="flex flex-col items-start gap-3">
        <Notice tone="error">
          {q.error instanceof ApiError && q.error.code !== 'NETWORK'
            ? tError(q.error.code)
            : t('rides.err')}
        </Notice>
        <Button variant="secondary" onClick={() => void q.refetch()}>
          {t('common.retry')}
        </Button>
      </div>
    );

  const items = q.data.pages.flatMap((p) => p.items);
  if (items.length === 0)
    return when === 'past' ? (
      <p className="py-8 text-center text-text-muted">{t('rides.empty.past')}</p>
    ) : (
      <EmptyState title={t('rides.empty.driving.title')} body={t('rides.empty.driving.body')}>
        <Link to="/offer" className="btn btn-primary">
          {t('rides.empty.driving.cta')}
        </Link>
      </EmptyState>
    );

  return (
    <div className="flex flex-col gap-3">
      <ul className="m-0 flex list-none flex-col gap-3 p-0">
        {items.map((r) => (
          <li key={r.id}>
            <RideCard ride={r} />
          </li>
        ))}
      </ul>
      {q.hasNextPage && (
        <Button
          variant="secondary"
          loading={q.isFetchingNextPage}
          onClick={() => void q.fetchNextPage()}
        >
          {t('rides.more')}
        </Button>
      )}
    </div>
  );
}

function RidingList({ when }: { when: When }) {
  const q = useInfiniteQuery({
    queryKey: keys.bookings.list(when),
    queryFn: ({ pageParam, signal }) => getMyBookings(when, pageParam, signal),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.nextCursor ?? undefined,
  });

  if (q.isPending)
    return (
      <div aria-busy="true">
        <Loader label={t('rides.riding.loading')} />
      </div>
    );
  if (q.isError)
    return (
      <div className="flex flex-col items-start gap-3">
        <Notice tone="error">
          {q.error instanceof ApiError && q.error.code !== 'NETWORK'
            ? tError(q.error.code)
            : t('rides.riding.err')}
        </Notice>
        <Button variant="secondary" onClick={() => void q.refetch()}>
          {t('common.retry')}
        </Button>
      </div>
    );

  const items = q.data.pages.flatMap((p) => p.items);
  if (items.length === 0)
    return when === 'past' ? (
      <p className="py-8 text-center text-text-muted">{t('rides.empty.riding.past')}</p>
    ) : (
      <EmptyState title={t('rides.empty.riding.title')} body={t('rides.empty.riding.body')}>
        <Link to="/find" className="btn btn-primary">
          {t('rides.empty.riding.cta')}
        </Link>
      </EmptyState>
    );

  return (
    <div className="flex flex-col gap-3">
      <ul className="m-0 flex list-none flex-col gap-3 p-0">
        {items.map((b) => (
          <li key={b.id}>
            <BookingCard booking={b} />
          </li>
        ))}
      </ul>
      {q.hasNextPage && (
        <Button
          variant="secondary"
          loading={q.isFetchingNextPage}
          onClick={() => void q.fetchNextPage()}
        >
          {t('rides.more')}
        </Button>
      )}
    </div>
  );
}
