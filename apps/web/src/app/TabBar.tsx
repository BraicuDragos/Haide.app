import { NavLink } from 'react-router';
import { t, tp, type MessageKey } from '@/i18n';
import { Badge } from '@/ui/Badge';
import { Icon, type IconName } from '@/ui/Icon';

interface Tab {
  to: string;
  icon: IconName;
  label: MessageKey;
}

export const TABS: readonly Tab[] = [
  { to: '/find', icon: 'search', label: 'nav.find' },
  { to: '/offer', icon: 'offer', label: 'nav.offer' },
  { to: '/rides', icon: 'rides', label: 'nav.rides' },
  { to: '/profile', icon: 'user', label: 'nav.profile' },
];

/** Badge slot: pending requests (driver) plus unread status changes (passenger). Wired up in E4. */
function useUpdateCounts(): Record<string, number> {
  return {};
}

export function TabBar() {
  const counts = useUpdateCounts();
  return (
    <nav
      aria-label={t('nav.label')}
      className="sticky bottom-0 z-10 grid grid-cols-4 border-t border-border bg-surface pb-[env(safe-area-inset-bottom)]"
    >
      {TABS.map((tab) => {
        const n = counts[tab.to] ?? 0;
        return (
          <NavLink
            key={tab.to}
            to={tab.to}
            className={({ isActive }) =>
              [
                'relative flex min-h-16 flex-col items-center justify-center gap-0.5 px-1 py-2 text-sm leading-[18px] font-semibold no-underline',
                isActive
                  ? 'text-primary-700 before:absolute before:inset-x-[20%] before:top-0 before:h-[3px] before:rounded-b-[3px] before:bg-action'
                  : 'text-text-muted',
              ].join(' ')
            }
          >
            <Icon name={tab.icon} />
            <span>{t(tab.label)}</span>
            <Badge count={n} />
            {n > 0 && <span className="sr-only">, {tp('nav.updates', n)}</span>}
          </NavLink>
        );
      })}
    </nav>
  );
}
