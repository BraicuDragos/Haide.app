import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { getSuspendedUsers } from '@/api/admin';
import { keys } from '@/api/keys';
import { t } from '@/i18n';
import { EmptyState } from '@/ui/EmptyState';
import { AdminActionSheet, type AdminAction } from '../components/AdminActionSheet';
import { AdminView } from '../components/AdminView';
import { reasonLabel, shortDate } from '../format';

/** Screen 7.3: who is suspended, on what ground, with what statement, and Unsuspend. */
export default function SuspendedScreen() {
  const [action, setAction] = useState<AdminAction | null>(null);
  const q = useQuery({
    queryKey: keys.admin.suspended,
    queryFn: ({ signal }) => getSuspendedUsers(signal),
  });
  return (
    <>
      <AdminView title={t('admin.suspended.title')} query={q}>
        {({ items }) =>
          items.length === 0 ? (
            <EmptyState
              title={t('admin.suspended.empty.title')}
              body={t('admin.suspended.empty.body')}
            />
          ) : (
            <ul className="grid list-none grid-cols-1 gap-3 xl:grid-cols-2">
              {items.map((s) => (
                <li key={s.user.id} className="flex">
                  <article className="card flex min-w-0 flex-1 flex-col gap-3 p-4">
                    <h2 className="type-h3">{s.user.firstName ?? t('admin.deletedUser')}</h2>
                    <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-sm leading-5">
                      <dt className="text-text-muted">{t('admin.suspended.ground')}</dt>
                      <dd>{s.reasonCode ? reasonLabel(s.reasonCode) : t('admin.noValue')}</dd>
                      <dt className="text-text-muted">{t('admin.suspended.since')}</dt>
                      <dd>{shortDate(s.suspendedAt)}</dd>
                      <dt className="text-text-muted">{t('admin.suspended.by')}</dt>
                      <dd>{s.adminFirstName ?? t('admin.noValue')}</dd>
                    </dl>
                    {s.statement && <p className="text-sm leading-5">{s.statement}</p>}
                    <div className="mt-auto pt-1">
                      <button
                        type="button"
                        className="btn btn-secondary"
                        onClick={() =>
                          setAction({
                            kind: 'unsuspend',
                            user: { id: s.user.id, firstName: s.user.firstName },
                          })
                        }
                      >
                        {t('admin.action.unsuspendBtn')}
                      </button>
                    </div>
                  </article>
                </li>
              ))}
            </ul>
          )
        }
      </AdminView>
      <AdminActionSheet action={action} onClose={() => setAction(null)} />
    </>
  );
}
