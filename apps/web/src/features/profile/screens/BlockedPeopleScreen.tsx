import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { ApiError } from '@/api/client';
import { keys } from '@/api/keys';
import { deleteBlock, getMyBlocks } from '@/api/safety';
import type { BlockedUser } from '@/api/types';
import { useBack } from '@/app/useBack';
import { RequireAuth } from '@/auth/RequireAuth';
import { invalidateAfterSafety } from '@/features/safety/invalidate';
import { t, tError } from '@/i18n';
import { dayLabel } from '@/lib/dates';
import { Avatar } from '@/ui/Avatar';
import { Button } from '@/ui/Button';
import { EmptyState } from '@/ui/EmptyState';
import { Loader } from '@/ui/Loader';
import { Notice } from '@/ui/Notice';
import { PageHeader } from '@/ui/PageHeader';
import { useToast } from '@/ui/Toast';

type Blocks = { items: BlockedUser[] };

/** Blocked people (6.3): who you blocked, and Unblock. Unblocking restores nothing that was cancelled. */
export default function BlockedPeopleScreen() {
  return (
    <RequireAuth title={t('block.title.list')}>
      <Blocked />
    </RequireAuth>
  );
}

function Blocked() {
  const back = useBack('/profile');
  const qc = useQueryClient();
  const toast = useToast();
  const [error, setError] = useState<string | null>(null);
  const q = useQuery({ queryKey: keys.blocks, queryFn: ({ signal }) => getMyBlocks(signal) });

  const unblock = useMutation({
    mutationFn: (u: BlockedUser['user']) => deleteBlock(u.id),
    // Optimistic: the row leaves at once and comes back if the call fails.
    onMutate: async (u) => {
      setError(null);
      await qc.cancelQueries({ queryKey: keys.blocks });
      const before = qc.getQueryData<Blocks>(keys.blocks);
      qc.setQueryData<Blocks>(keys.blocks, (old) =>
        old ? { items: old.items.filter((i) => i.user.id !== u.id) } : old,
      );
      return { before };
    },
    onError: (err, _u, ctx) => {
      if (ctx?.before) qc.setQueryData(keys.blocks, ctx.before);
      setError(tError(err instanceof ApiError ? err.code : 'NETWORK'));
    },
    onSuccess: (_r, u) => {
      toast.show(t('block.unblocked', { name: u.firstName ?? t('pub.deleted') }));
      invalidateAfterSafety(qc, { userId: u.id });
    },
  });

  const header = <PageHeader title={t('block.title.list')} onBack={back} />;
  if (q.isPending)
    return (
      <>
        {header}
        <div aria-busy="true">
          <Loader label={t('block.loading')} />
        </div>
      </>
    );
  if (q.isError)
    return (
      <>
        {header}
        <div className="flex flex-col items-start gap-3 p-4">
          <Notice tone="error">{t('block.err')}</Notice>
          <Button variant="secondary" onClick={() => void q.refetch()}>
            {t('common.retry')}
          </Button>
        </div>
      </>
    );

  const items = q.data.items;
  return (
    <>
      {header}
      {items.length === 0 ? (
        <EmptyState title={t('block.title.list')} body={t('block.empty')} />
      ) : (
        <div className="flex flex-col gap-3 px-4 pt-4 pb-6">
          {error && <Notice tone="error">{error}</Notice>}
          <ul className="group">
            {items.map(({ user, blockedAt }) => {
              const name = user.firstName ?? t('pub.deleted');
              return (
                <li key={user.id} className="flex items-center gap-3 p-4">
                  <Avatar name={user.firstName} photoUrl={user.photoUrl} />
                  <span className="flex min-w-0 flex-1 flex-col">
                    <span className="truncate font-semibold">{name}</span>
                    <span className="text-sm leading-5 text-text-muted">
                      {t('block.since', { when: dayLabel(blockedAt) })}
                    </span>
                  </span>
                  <Button
                    variant="secondary"
                    aria-label={t('block.unblock.name', { name })}
                    disabled={unblock.isPending}
                    onClick={() => unblock.mutate(user)}
                  >
                    {t('block.unblock')}
                  </Button>
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </>
  );
}
