import { useInfiniteQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { getAdminReports, type ReportFilter } from '@/api/admin';
import { keys } from '@/api/keys';
import { t, type MessageKey } from '@/i18n';
import { Button } from '@/ui/Button';
import { EmptyState } from '@/ui/EmptyState';
import { AdminActionSheet, type AdminAction } from '../components/AdminActionSheet';
import { AdminView } from '../components/AdminView';
import { ReportCard } from '../components/ReportCard';

const TABS: Array<{ id: ReportFilter; label: MessageKey }> = [
  { id: 'open', label: 'admin.reports.tab.open' },
  { id: 'dismissed', label: 'admin.reports.tab.dismissed' },
  { id: 'actioned', label: 'admin.reports.tab.actioned' },
  { id: 'all', label: 'admin.reports.tab.all' },
];

/** Screen 7.2: the report queue. Open first; each row offers only the actions that still make sense. */
export default function ReportsScreen() {
  const [status, setStatus] = useState<ReportFilter>('open');
  const [action, setAction] = useState<AdminAction | null>(null);
  const q = useInfiniteQuery({
    queryKey: keys.admin.reports(status),
    queryFn: ({ pageParam, signal }) => getAdminReports(status, pageParam, signal),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.nextCursor ?? undefined,
  });
  // AdminView takes a plain query result: hand it the flattened items.
  const flat = {
    isPending: q.isPending,
    isError: q.isError,
    error: q.error,
    refetch: q.refetch,
    data: q.data ? q.data.pages.flatMap((p) => p.items) : undefined,
  };

  return (
    <>
      <AdminView
        title={t('admin.reports.title')}
        query={flat}
        extra={
          <div role="group" aria-label={t('admin.reports.filter')} className="seg max-w-lg">
            {TABS.map((tab) => (
              <label key={tab.id}>
                <input
                  type="radio"
                  name="report-status"
                  checked={status === tab.id}
                  onChange={() => setStatus(tab.id)}
                />
                {t(tab.label)}
              </label>
            ))}
          </div>
        }
      >
        {(items) =>
          items.length === 0 ? (
            <EmptyState
              title={t('admin.reports.empty.title')}
              body={t(status === 'open' ? 'admin.reports.empty.open' : 'admin.reports.empty.other')}
            />
          ) : (
            <>
              <ul className="grid list-none grid-cols-1 gap-3 xl:grid-cols-2">
                {items.map((r) => (
                  <li key={r.id} className="flex">
                    <ReportCard report={r} onAction={setAction} />
                  </li>
                ))}
              </ul>
              {q.hasNextPage && (
                <Button
                  variant="secondary"
                  className="self-center"
                  loading={q.isFetchingNextPage}
                  onClick={() => void q.fetchNextPage()}
                >
                  {t('admin.reports.loadMore')}
                </Button>
              )}
            </>
          )
        }
      </AdminView>
      <AdminActionSheet action={action} onClose={() => setAction(null)} />
    </>
  );
}
