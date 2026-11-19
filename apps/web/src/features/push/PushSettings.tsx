import { useState } from 'react';
import { t } from '@/i18n';
import { Icon } from '@/ui/Icon';
import { useToast } from '@/ui/Toast';
import { usePush } from './usePush';

/**
 * Settings row for push (E8-4): an on/off switch for this device. Hidden when the browser cannot do push or the server
 * has it off; on iOS in a browser tab it explains the Home Screen step instead. Turning on here asks the browser
 * directly (the person already chose to look for the switch), turning off unsubscribes and deletes on the server.
 */
export default function PushSettings() {
  const push = usePush();
  const toast = useToast();
  const [failed, setFailed] = useState(false);

  if (push.loading || push.support === 'unsupported') return null;
  if (push.support === 'ios-install')
    return (
      <li className="flex items-start gap-3 px-4 py-3 text-text-muted">
        <Icon name="info" className="mt-0.5" />
        <p className="text-sm leading-5">{t('push.ios')}</p>
      </li>
    );

  const blocked = push.permission === 'denied';
  const on = push.subscribed === true;
  const hintId = 'push-hint';
  const toggle = async (next: boolean) => {
    setFailed(false);
    if (next) {
      const r = await push.enable();
      if (r === 'on') toast.show(t('push.on.toast'));
      else if (r === 'error') setFailed(true);
    } else if (await push.disable()) toast.show(t('push.off.toast'));
    else setFailed(true);
  };

  return (
    <li className="flex flex-col gap-1 px-4 py-2">
      <div className="flex min-h-12 items-center justify-between gap-3">
        <label htmlFor="push-switch" className="flex flex-1 flex-col">
          <span className="font-semibold">{t('settings.push')}</span>
          <span id={hintId} className="text-sm leading-5 text-text-muted">
            {blocked ? t('settings.push.denied') : t('settings.push.hint')}
          </span>
        </label>
        <span aria-hidden="true" className="text-sm leading-5 font-semibold text-text-muted">
          {on ? t('settings.push.value.on') : t('settings.push.value.off')}
        </span>
        <input
          id="push-switch"
          type="checkbox"
          role="switch"
          className="switch"
          checked={on}
          disabled={push.busy || push.subscribed === null || (blocked && !on)}
          aria-describedby={hintId}
          onChange={(e) => void toggle(e.target.checked)}
        />
      </div>
      {(failed || push.error) && (
        <p role="alert" className="text-sm leading-5 font-semibold text-error">
          {t('settings.push.err')}
        </p>
      )}
    </li>
  );
}
