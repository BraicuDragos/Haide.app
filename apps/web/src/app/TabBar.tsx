import { NavLink } from 'react-router';
import { t, tp, type MessageKey } from '@/i18n';
import { useReducedMotion } from '@/lib/prefs';
import { Badge } from '@/ui/Badge';
import { Icon, type IconName } from '@/ui/Icon';
import { ridesBadgeCount, useSummary } from '@/features/bookings/useSummary';

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

/** Badge on My rides: pending requests (driver) plus unseen status changes (passenger), from GET /me/summary. */
function useUpdateCounts(): Record<string, number> {
  const summary = useSummary().data;
  return { '/rides': ridesBadgeCount(summary) };
}

/**
 * Four tabs on the one blurred layer. Tab changes use a View Transition (a quick crossfade; the bar itself keeps its
 * `tabbar` name so it does not flash). Instant with reduced motion or without browser support.
 */
export function TabBar() {
  const counts = useUpdateCounts();
  const reduced = useReducedMotion();
  return (
    <nav
      aria-label={t('nav.label')}
      className="tabbar sticky bottom-0 z-10 grid grid-cols-4 pb-[env(safe-area-inset-bottom)]"
    >
      {TABS.map((tab) => {
        const n = counts[tab.to] ?? 0;
        return (
          <NavLink
            key={tab.to}
            to={tab.to}
            viewTransition={!reduced}
            className={({ isActive }) =>
              [
                'relative flex min-h-16 flex-col items-center justify-center gap-0.5 px-1 py-1.5 text-sm leading-[18px] font-semibold no-underline',
                isActive ? 'text-text' : 'text-text-muted',
              ].join(' ')
            }
          >
            {({ isActive }) => (
              <>
                <span
                  className={`grid h-[30px] w-14 place-items-center rounded-full transition-colors duration-(--tk-dur-base) ease-standard ${isActive ? 'bg-tint text-on-tint' : ''}`}
                >
                  <Icon name={tab.icon} />
                </span>
                <span>{t(tab.label)}</span>
                <Badge count={n} />
                {n > 0 && <span className="sr-only">, {tp('nav.updates', n)}</span>}
              </>
            )}
          </NavLink>
        );
      })}
    </nav>
  );
}
