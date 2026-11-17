import { useMutation } from '@tanstack/react-query';
import { Link } from 'react-router';
import { requestDataExport } from '@/api/privacy';
import { ApiError } from '@/api/client';
import { longDate } from '@/lib/dates';
import { t, tError } from '@/i18n';
import { Icon } from '@/ui/Icon';
import { useToast } from '@/ui/Toast';

const ROW = 'flex min-h-14 w-full items-center gap-3 px-4 py-2 text-left text-text no-underline';

/**
 * The two account-level rows of Settings > Privacy and data (6.5, 6.4): "Request a copy of my data" and
 * "Delete account". Rendered inside the same `.group` list as the policy links. The data request row keeps its
 * confirmation on screen (not only in a toast) so it survives the toast timing out.
 */
export function PrivacyRows() {
  const toast = useToast();
  const request = useMutation({
    mutationFn: requestDataExport,
    onSuccess: (r) => {
      // A request from the last minute is new. An older one is the open request the server returned again.
      const isNew = Date.now() - Date.parse(r.requestedAt) < 60_000;
      toast.show(
        isNew
          ? t('settings.data.toast')
          : t('settings.data.pending', { date: longDate(r.requestedAt), due: longDate(r.dueBy) }),
      );
    },
    onError: (err) => toast.show(tError(err instanceof ApiError ? err.code : undefined)),
  });

  const sent = request.data;
  return (
    <>
      <li>
        <button
          type="button"
          onClick={() => request.mutate()}
          disabled={request.isPending}
          aria-busy={request.isPending || undefined}
          className={`${ROW} hover:bg-surface-subtle disabled:opacity-60`}
        >
          <Icon name={sent ? 'done' : 'mail'} className={sent ? 'text-savings' : 'text-link'} />
          <span className="flex min-w-0 flex-1 flex-col">
            <span className="font-semibold">{t('settings.data')}</span>
            {sent && (
              <span role="status" className="text-sm leading-5 text-text-muted">
                {t('settings.data.pending', {
                  date: longDate(sent.requestedAt),
                  due: longDate(sent.dueBy),
                })}
              </span>
            )}
          </span>
        </button>
      </li>
      <li>
        <Link to="/delete" className={`${ROW} text-error hover:bg-error-bg`}>
          <Icon name="alert" />
          <span className="flex-1 font-semibold">{t('settings.delete')}</span>
          <Icon name="chev" small />
        </Link>
      </li>
    </>
  );
}
