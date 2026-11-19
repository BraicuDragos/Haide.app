import { useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'react-router';
import { useAuth } from '@/auth/AuthProvider';
import { useGate, useMe } from '@/auth/hooks';
import { nextStep } from '@/auth/onboarding';
import { lazySheet } from '@/features/safety/lazySheet';
import { t } from '@/i18n';
import { Button } from '@/ui/Button';
import type { SearchCriteria } from '@/features/find/searchState';

const Sheet = lazySheet(() => import('./NotifyMeSheet'));

const RETURN_TO = '/results?notify=1';

/**
 * Opens the "Notify me" sheet. Signed out (or with onboarding left): the tap starts it and returns to the results with
 * `?notify=1`, which reopens the sheet once (return-to-intent, ADR 0010). `variant="link"` is the quiet text link
 * under non-empty results; the empty state uses the primary button.
 */
export function NotifyMeButton({
  criteria,
  variant,
}: {
  criteria: SearchCriteria;
  variant: 'primary' | 'link';
}) {
  const gate = useGate();
  const { status } = useAuth();
  const me = useMe().data;
  const [params, setParams] = useSearchParams();
  const [open, setOpen] = useState(false);

  const done = useRef(false);
  useEffect(() => {
    if (done.current || params.get('notify') !== '1') return;
    if (status !== 'signedIn' || !me) return;
    done.current = true;
    setParams({}, { replace: true });
    if (!nextStep(me, { kind: 'other', returnTo: RETURN_TO })) setOpen(true);
  }, [params, setParams, status, me]);

  const start = () => {
    if (gate({ kind: 'other', returnTo: RETURN_TO })) setOpen(true);
  };

  return (
    <>
      {variant === 'primary' ? (
        <Button onClick={start}>{t('alerts.notify')}</Button>
      ) : (
        <button
          type="button"
          onClick={start}
          className="inline-flex min-h-12 w-fit items-center text-sm font-semibold text-action underline"
        >
          {t('alerts.notify')}
        </button>
      )}
      <Sheet open={open} onClose={() => setOpen(false)} criteria={criteria} />
    </>
  );
}
