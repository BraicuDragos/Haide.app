import '../messages';
import type { ReactNode } from 'react';
import { ApiError } from '@/api/client';
import { useBack } from '@/app/useBack';
import { t, tError } from '@/i18n';
import { Button } from '@/ui/Button';
import { Loader } from '@/ui/Loader';
import { Notice } from '@/ui/Notice';
import { PageHeader } from '@/ui/PageHeader';

/**
 * Header (the one h1) plus the three non-success states of an admin query: loading, error with retry, and the
 * success render. `extra` shows above the data while it loads (week picker, tabs) so controls never jump.
 */
export function AdminView<T>({
  title,
  query,
  extra,
  children,
}: {
  title: string;
  query: QueryLike<T>;
  extra?: ReactNode;
  children: (data: T) => ReactNode;
}) {
  const back = useBack('/profile');
  return (
    <>
      <PageHeader title={title} onBack={back} />
      <div className="flex min-w-0 flex-col gap-5 px-4 pt-4 pb-10">
        {extra}
        {query.isPending ? (
          <div aria-busy="true">
            <Loader label={t('admin.loading')} />
          </div>
        ) : query.isError ? (
          <div className="flex flex-col items-start gap-3">
            <Notice tone="error">
              {tError(query.error instanceof ApiError ? query.error.code : undefined)}
            </Notice>
            <Button variant="secondary" onClick={() => void query.refetch()}>
              {t('common.retry')}
            </Button>
          </div>
        ) : (
          children(query.data as T)
        )}
      </div>
    </>
  );
}

/** The slice of a query result the view needs, so infinite queries can pass flattened data. */
export interface QueryLike<T> {
  isPending: boolean;
  isError: boolean;
  error: unknown;
  data: T | undefined;
  refetch: () => unknown;
}
