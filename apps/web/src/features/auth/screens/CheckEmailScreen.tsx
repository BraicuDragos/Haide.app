import { useState } from 'react';
import { Navigate, useLocation, useNavigate } from 'react-router';
import { useAuth } from '@/auth/AuthProvider';
import { t } from '@/i18n';
import { Button } from '@/ui/Button';
import { Icon } from '@/ui/Icon';
import { Notice } from '@/ui/Notice';
import { PageHeader } from '@/ui/PageHeader';
import { useToast } from '@/ui/Toast';
import { authErrorMessage } from '../authErrors';

/** Screen 1.2: magic-link instructions. The address comes from router state, never from the URL. */
export function CheckEmailScreen() {
  const email = (useLocation().state as { email?: string } | null)?.email;
  const navigate = useNavigate();
  const { sendMagicLink } = useAuth();
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();

  if (!email) return <Navigate to="/auth" replace />;

  async function resend() {
    setError(undefined);
    setBusy(true);
    try {
      await sendMagicLink(email as string);
      toast.show(t('auth.check.resent'));
    } catch (e) {
      setError(authErrorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <PageHeader
        title={t('auth.check.title')}
        onBack={() => void navigate('/auth', { replace: true })}
      />
      <div className="flex flex-col items-center gap-4 px-4 py-8 text-center">
        <span className="grid size-20 place-items-center rounded-full bg-primary-100 text-primary-800">
          <Icon name="mail" className="size-9" />
        </span>
        <p className="max-w-[32ch] break-words">{t('auth.check.body', { email })}</p>
        {error && <Notice tone="error">{error}</Notice>}
        <div className="mt-2 flex w-full flex-col gap-2">
          <Button variant="secondary" block loading={busy} onClick={() => void resend()}>
            {t('auth.check.resend')}
          </Button>
          <Button variant="ghost" block onClick={() => void navigate('/auth', { replace: true })}>
            {t('auth.check.wrong')}
          </Button>
        </div>
      </div>
    </>
  );
}
