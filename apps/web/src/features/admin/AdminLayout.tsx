import './messages';
import { NavLink, Outlet } from 'react-router';
import { RequireAuth, ScreenSkeleton } from '@/auth/RequireAuth';
import { useMe } from '@/auth/hooks';
import { NotFoundScreen } from '@/features/common/screens/NotFoundScreen';
import { t, type MessageKey } from '@/i18n';
import { Icon, type IconName } from '@/ui/Icon';

const NAV: Array<{ to: string; end?: boolean; icon: IconName; label: MessageKey }> = [
  { to: '/admin', end: true, icon: 'route', label: 'admin.nav.metrics' },
  { to: '/admin/reports', icon: 'shield', label: 'admin.nav.reports' },
  { to: '/admin/users', icon: 'lock', label: 'admin.nav.suspended' },
  { to: '/admin/energy', icon: 'car', label: 'admin.nav.energy' },
  { to: '/admin/ops', icon: 'info', label: 'admin.nav.ops' },
];

const LINK =
  'flex min-h-11 flex-none items-center gap-2 rounded-full px-4 font-semibold whitespace-nowrap no-underline lg:rounded-lg';

/**
 * Admin area shell. Non-admins get the not-found screen (the server answers 403 on every call anyway). The nav is a
 * side rail from 1024 px and a scrollable bar below; the current page is marked with aria-current.
 */
export default function AdminLayout() {
  return (
    <RequireAuth title={t('admin.title')}>
      <Gate />
    </RequireAuth>
  );
}

function Gate() {
  const me = useMe();
  if (me.isPending) return <ScreenSkeleton title={t('admin.title')} />;
  if (me.data?.role !== 'admin') return <NotFoundScreen />;
  return (
    <div className="flex min-w-0 flex-1 flex-col lg:flex-row">
      <nav
        aria-label={t('admin.nav.label')}
        className="flex-none border-b border-(color:--hair) lg:w-60 lg:border-r lg:border-b-0"
      >
        <ul className="flex list-none gap-1 overflow-x-auto px-3 py-2 lg:sticky lg:top-0 lg:flex-col lg:gap-1 lg:px-3 lg:py-4">
          {NAV.map((n) => (
            <li key={n.to} className="flex-none lg:w-full">
              <NavLink
                to={n.to}
                end={n.end}
                className={({ isActive }) =>
                  `${LINK} ${isActive ? 'bg-tint text-on-tint' : 'text-text-muted hover:bg-surface-subtle'}`
                }
              >
                <Icon name={n.icon} small />
                {t(n.label)}
              </NavLink>
            </li>
          ))}
        </ul>
      </nav>
      <div className="min-w-0 flex-1">
        <Outlet />
      </div>
    </div>
  );
}
