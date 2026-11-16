import type { Call112Window } from '@/api/types';
import { t } from '@/i18n';
import { Icon } from '@/ui/Icon';
import { useNow } from './useNow';

/** True while `from <= now < until`. Both ends come from the server; this only compares. */
export function inCall112Window(window: Call112Window | null | undefined, now: number): boolean {
  if (!window) return false;
  return Date.parse(window.from) <= now && now < Date.parse(window.until);
}

/**
 * Call 112 (5.6): a plain `tel:` link, shown only inside the window the server computed. Red outline, never a fill
 * (it must not read as the primary action), phone icon plus words. The hint says it is for emergencies.
 */
export function Call112Button({ window }: { window: Call112Window | null | undefined }) {
  const now = useNow(30_000);
  if (!window || !inCall112Window(window, now)) return null;
  return (
    <div className="flex flex-col items-start gap-1">
      <a href="tel:112" aria-label={t('a11y.call112')} className="btn btn-danger btn-block">
        <Icon name="phone" />
        {t('rideday.call112')}
      </a>
      <p className="text-sm leading-5 text-text-muted">{t('rideday.call112.hint')}</p>
    </div>
  );
}
