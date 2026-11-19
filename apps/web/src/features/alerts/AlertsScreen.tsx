import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Link } from 'react-router';
import { ApiError } from '@/api/client';
import { keys } from '@/api/keys';
import { deleteAlert, getAlerts, type RideAlert } from '@/api/liquidity';
import { useBack } from '@/app/useBack';
import { RequireAuth } from '@/auth/RequireAuth';
import { t, tError } from '@/i18n';
import { bucharestToday, dateLabel } from '@/lib/dates';
import { Button } from '@/ui/Button';
import { EmptyState } from '@/ui/EmptyState';
import { Loader } from '@/ui/Loader';
import { Notice } from '@/ui/Notice';
import { PageHeader } from '@/ui/PageHeader';
import { useToast } from '@/ui/Toast';

const BACK = '/profile';

/** Ride alerts (E8-2): the active alerts, newest first, each with a Delete. Reached from Settings. */
export default function AlertsScreen() {
  return (
    <RequireAuth title={t('alerts.title')}>
      <Alerts />
    </RequireAuth>
  );
}

function when(a: RideAlert): string {
  const win = t(`find.window.${a.windowMin}`);
  const at = t('alerts.at', { time: a.time, win });
  const day =
    a.schedule.kind === 'date'
      ? t('alerts.on', { date: dateLabel(a.schedule.date) })
      : t('alerts.every', {
          days: a.schedule.weekdays.map((d) => t(`weekday.${d}.short`)).join(', '),
        });
  return `${day} · ${at}`;
}

function Alerts() {
  const back = useBack(BACK);
  const q = useQuery({ queryKey: keys.alerts, queryFn: ({ signal }) => getAlerts(signal) });

  return (
    <>
      <PageHeader title={t('alerts.title')} onBack={back} />
      {q.isPending && (
        <div aria-busy="true">
          <Loader label={t('alerts.loading')} />
        </div>
      )}
      {q.isError && (
        <div className="flex flex-col items-start gap-3 p-4">
          <Notice tone="error">
            {q.error instanceof ApiError && q.error.code !== 'NETWORK'
              ? tError(q.error.code)
              : t('alerts.err')}
          </Notice>
          <Button variant="secondary" onClick={() => void q.refetch()}>
            {t('common.retry')}
          </Button>
        </div>
      )}
      {q.data && q.data.items.length === 0 && (
        <EmptyState title={t('alerts.empty.title')} body={t('alerts.empty')}>
          <Link to="/find" className="btn btn-primary">
            {t('alerts.empty.cta')}
          </Link>
        </EmptyState>
      )}
      {q.data && q.data.items.length > 0 && (
        <div className="flex flex-col gap-4 px-4 pt-4 pb-6">
          <p className="text-sm leading-5 text-text-muted">{t('alerts.hint')}</p>
          <ul aria-label={t('alerts.list')} className="m-0 flex list-none flex-col gap-3 p-0">
            {q.data.items.map((a) => (
              <AlertRow key={a.id} alert={a} />
            ))}
          </ul>
        </div>
      )}
    </>
  );
}

function AlertRow({ alert: a }: { alert: RideAlert }) {
  const qc = useQueryClient();
  const toast = useToast();
  const [error, setError] = useState<string | null>(null);
  const del = useMutation({
    mutationFn: () => deleteAlert(a.id),
    onSuccess: () => {
      qc.setQueryData<{ items: RideAlert[] }>(keys.alerts, (old) =>
        old ? { items: old.items.filter((x) => x.id !== a.id) } : old,
      );
      toast.show(t('alerts.deleted'));
    },
    onError: (e) => {
      // Already gone (expired or deleted elsewhere): the list is simply refreshed.
      if (e instanceof ApiError && e.status === 404)
        void qc.invalidateQueries({ queryKey: keys.alerts });
      else setError(t('alerts.delete.err'));
    },
  });
  return (
    <li className="card flex flex-col gap-2 p-4">
      <p className="font-semibold">{t('alerts.route', { from: a.fromLabel, to: a.toLabel })}</p>
      <p className="text-sm leading-5">{when(a)}</p>
      <p className="text-sm leading-5 text-text-muted">
        {t('alerts.ends', { date: dateLabel(bucharestToday(new Date(a.expiresAt))) })}
      </p>
      {error && <Notice tone="error">{error}</Notice>}
      <Button
        variant="secondary"
        className="self-start"
        loading={del.isPending}
        aria-label={t('alerts.delete.aria', { from: a.fromLabel, to: a.toLabel })}
        onClick={() => del.mutate()}
      >
        {t('alerts.delete')}
      </Button>
    </li>
  );
}
