import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router';
import { useAuth } from '@/auth/AuthProvider';
import { useAdvance } from '@/auth/hooks';
import { t } from '@/i18n';
import { Button } from '@/ui/Button';
import { Notice } from '@/ui/Notice';
import { Loader } from '@/ui/Loader';
import { PageHeader } from '@/ui/PageHeader';

type Phase = 'working' | 'expired' | 'failed';

/** Reads `code`/`error*` from the query string and, for providers that use it, the hash. */
function readParams() {
  const q = new URLSearchParams(window.location.search);
  const h = new URLSearchParams(window.location.hash.replace(/^#/, ''));
  const get = (k: string) => q.get(k) ?? h.get(k);
  return { code: q.get('code'), error: get('error'), errorCode: get('error_code') };
}

/**
 * /auth/callback: finishes PKCE (Google and magic link). On success continues onboarding or returns to the saved
 * intent. An expired or reused link gets its own message and a way to ask for a new one (copy.md 14).
 */
export function CallbackScreen() {
  const navigate = useNavigate();
  const advance = useAdvance();
  const { status, exchangeCode } = useAuth();
  const [phase, setPhase] = useState<Phase>('working');

  useEffect(() => {
    if (status === 'loading') return;
    let cancelled = false;
    const { code, error, errorCode } = readParams();
    void (async () => {
      try {
        if (error || (!code && status === 'signedOut')) {
          if (!cancelled) setPhase(errorCode === 'otp_expired' || !error ? 'expired' : 'failed');
          return;
        }
        if (code) await exchangeCode(code);
        await advance();
      } catch {
        // A used or expired code is the common case; any exchange failure reads the same to the person.
        if (!cancelled) setPhase('expired');
      }
    })();
    return () => {
      cancelled = true;
    };
    // `status` flips once after the exchange: the exchange itself is memoised per code, so re-running is safe.
  }, [status, exchangeCode, advance]);

  if (phase === 'working') {
    return (
      <>
        <PageHeader title={t('auth.callback.title')} />
        <Loader label={t('auth.callback.loading')} />
      </>
    );
  }

  return (
    <>
      <PageHeader title={t('auth.link.expired.title')} />
      <div className="flex flex-col gap-4 px-4 py-6">
        <Notice tone="error">
          {phase === 'expired' ? t('auth.link.expired') : t('error.generic')}
        </Notice>
        <Button block onClick={() => void navigate('/auth', { replace: true })}>
          {t('auth.check.resend')}
        </Button>
      </div>
    </>
  );
}
