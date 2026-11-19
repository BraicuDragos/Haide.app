import { useEffect, useState } from 'react';
import { pushPromptSnoozed, snoozePushPrompt } from '@/lib/prefs';
import { useToast } from '@/ui/Toast';
import { t } from '@/i18n';
import { PushPromptSheet } from './PushPromptSheet';
import { resyncPush } from './pushActions';
import { clearPushPrompt } from './trigger';
import { browserPushDeps, usePush } from './usePush';

/**
 * The lazy half of the push host: re-registers an existing subscription once per session (the browser may have rotated
 * it) and shows the pre-prompt when a booking or publish just happened and the person was not asked in the last 30 days.
 */
export default function PushHostImpl({ due }: { due: boolean }) {
  const push = usePush();
  const toast = useToast();
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (push.support !== 'supported' || push.permission !== 'granted') return;
    void resyncPush(browserPushDeps()).catch(() => undefined); // once per session; a failure retries on the next mount
  }, [push.support, push.permission]);

  const eligible =
    due &&
    push.support === 'supported' &&
    push.permission === 'default' &&
    push.subscribed === false &&
    !pushPromptSnoozed();
  useEffect(() => {
    if (eligible) setOpen(true);
  }, [eligible]);
  // Not eligible (already on, blocked, snoozed, not supported): the moment passes without a trace.
  useEffect(() => {
    if (
      due &&
      push.support !== 'ios-install' &&
      !push.loading &&
      push.subscribed !== null &&
      !eligible
    )
      clearPushPrompt();
  }, [due, push.support, push.loading, push.subscribed, eligible]);

  const close = () => {
    setOpen(false);
    clearPushPrompt();
  };

  return (
    <PushPromptSheet
      open={open}
      busy={push.busy}
      error={push.error}
      onTurnOn={() => {
        void push.enable().then((r) => {
          if (r === 'on') {
            toast.show(t('push.on.toast'));
            close();
          } else if (r === 'denied') close();
        });
      }}
      onNotNow={() => {
        snoozePushPrompt();
        close();
      }}
    />
  );
}
