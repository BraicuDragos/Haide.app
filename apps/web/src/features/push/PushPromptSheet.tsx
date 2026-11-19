import { t } from '@/i18n';
import { Button } from '@/ui/Button';
import { Notice } from '@/ui/Notice';
import { Sheet } from '@/ui/Sheet';

interface Props {
  open: boolean;
  busy: boolean;
  error: boolean;
  onTurnOn: () => void;
  onNotNow: () => void;
}

/**
 * Pre-prompt (E8-4): shown once after the first booking request or the first publish, never on first load. The browser's
 * own permission dialog only opens after "Turn on", so a "no" here costs nothing and a "no" there is rare.
 */
export function PushPromptSheet({ open, busy, error, onTurnOn, onNotNow }: Props) {
  return (
    <Sheet open={open} title={t('push.prompt.title')} onClose={onNotNow}>
      <p>{t('push.prompt.body')}</p>
      {error && <Notice tone="error">{t('settings.push.err')}</Notice>}
      <div className="mt-auto flex flex-col gap-3">
        <Button block loading={busy} onClick={onTurnOn}>
          {t('push.turnOn')}
        </Button>
        <Button variant="secondary" block disabled={busy} onClick={onNotNow}>
          {t('push.notNow')}
        </Button>
      </div>
    </Sheet>
  );
}
