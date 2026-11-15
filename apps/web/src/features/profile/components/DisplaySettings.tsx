import { useId } from 'react';
import { t, type MessageKey } from '@/i18n';
import {
  setMotionPref,
  setThemePref,
  useMotionPref,
  useReducedMotion,
  useThemePref,
  type ThemePref,
} from '@/lib/prefs';

const THEMES: Array<{ value: ThemePref; label: MessageKey }> = [
  { value: 'system', label: 'settings.theme.system' },
  { value: 'dark', label: 'settings.theme.dark' },
  { value: 'light', label: 'settings.theme.light' },
];

/**
 * Display settings, available signed in or out: theme (system, dark, light) and the in-app Reduce motion switch.
 * The switch overrides the OS setting and is remembered on this device (WCAG 2.2.2): the moving light and ambient
 * animations stop, informational motion is replaced by instant changes.
 */
export function DisplaySettings() {
  const theme = useThemePref();
  const motionPref = useMotionPref();
  const reduced = useReducedMotion();
  const name = useId();
  const hintId = `${name}-hint`;
  return (
    <section aria-labelledby={`${name}-h`} className="flex flex-col gap-3 px-4">
      <h2 id={`${name}-h`} className="type-h3">
        {t('settings.display')}
      </h2>
      <fieldset className="m-0 flex min-w-0 flex-col gap-2 border-0 p-0">
        <legend className="type-label mb-1 p-0">{t('settings.theme')}</legend>
        <div className="seg">
          {THEMES.map((o) => (
            <label key={o.value}>
              <input
                type="radio"
                name={`${name}-theme`}
                value={o.value}
                checked={theme === o.value}
                onChange={() => setThemePref(o.value)}
              />
              {t(o.label)}
            </label>
          ))}
        </div>
      </fieldset>
      <div className="flex min-h-12 items-center justify-between gap-3">
        <label htmlFor={`${name}-motion`} className="flex flex-1 flex-col">
          <span className="type-label">{t('settings.reduceMotion')}</span>
          <span id={hintId} className="text-sm leading-5 text-text-muted">
            {t('settings.reduceMotion.hint')}
          </span>
        </label>
        <input
          id={`${name}-motion`}
          type="checkbox"
          role="switch"
          className="switch"
          checked={reduced}
          aria-describedby={hintId}
          data-pref={motionPref}
          onChange={(e) => setMotionPref(e.target.checked ? 'reduced' : 'full')}
        />
      </div>
    </section>
  );
}
