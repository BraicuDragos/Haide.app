import { useEffect, useRef, useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router';
import { useAuth } from '@/auth/AuthProvider';
import { clearIntent, readIntent } from '@/auth/intent';
import { useAdvance } from '@/auth/hooks';
import { t } from '@/i18n';
import { Button } from '@/ui/Button';
import { TextField } from '@/ui/Field';
import { Icon } from '@/ui/Icon';
import { Notice } from '@/ui/Notice';
import { PageHeader } from '@/ui/PageHeader';
import { authErrorMessage } from '../authErrors';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

/** Google's mark keeps its own brand colours (third-party logo, not a design token). */
function GoogleMark() {
  return (
    <svg viewBox="0 0 18 18" aria-hidden="true" focusable="false" className="size-5 flex-none">
      <path
        fill="#4285F4"
        d="M17.64 9.2c0-.64-.06-1.25-.16-1.84H9v3.48h4.84a4.14 4.14 0 0 1-1.8 2.72v2.26h2.92c1.7-1.57 2.68-3.88 2.68-6.62z"
      />
      <path
        fill="#34A853"
        d="M9 18c2.43 0 4.47-.8 5.96-2.18l-2.92-2.26c-.8.54-1.84.86-3.04.86-2.34 0-4.32-1.58-5.03-3.7H.96v2.33A9 9 0 0 0 9 18z"
      />
      <path
        fill="#FBBC05"
        d="M3.97 10.72A5.41 5.41 0 0 1 3.68 9c0-.6.1-1.18.29-1.72V4.95H.96A9 9 0 0 0 0 9c0 1.45.35 2.83.96 4.05l3.01-2.33z"
      />
      <path
        fill="#EA4335"
        d="M9 3.58c1.32 0 2.5.45 3.44 1.35l2.58-2.58C13.46.89 11.43 0 9 0A9 9 0 0 0 .96 4.95l3.01 2.33C4.68 5.16 6.66 3.58 9 3.58z"
      />
    </svg>
  );
}

/** Screen 1.1: Google or email link, no password. The subtitle names the action the user came for. */
export function SignInScreen() {
  const navigate = useNavigate();
  const advance = useAdvance();
  const { status, signInWithGoogle, sendMagicLink } = useAuth();
  const intent = readIntent();
  const [email, setEmail] = useState('');
  const [fieldError, setFieldError] = useState<string>();
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState<'google' | 'email' | null>(null);
  const emailRef = useRef<HTMLInputElement>(null);

  // Already signed in (for example an old tab): carry on with onboarding instead of showing sign-in.
  useEffect(() => {
    if (status === 'signedIn') void advance();
  }, [status, advance]);

  const subtitle =
    intent.kind === 'request'
      ? t('auth.subtitle.request')
      : intent.kind === 'offer'
        ? t('auth.subtitle.offer')
        : t('auth.subtitle.default');

  function close() {
    const { returnTo } = readIntent();
    clearIntent();
    void navigate(returnTo, { replace: true });
  }

  async function google() {
    setError(undefined);
    setBusy('google');
    try {
      await signInWithGoogle(); // navigates away to Google
    } catch (e) {
      setError(authErrorMessage(e));
      setBusy(null);
    }
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    const value = email.trim();
    setError(undefined);
    if (!EMAIL_RE.test(value)) {
      setFieldError(t('auth.email.err'));
      emailRef.current?.focus();
      return;
    }
    setFieldError(undefined);
    setBusy('email');
    try {
      await sendMagicLink(value);
      void navigate('/auth/check', { state: { email: value } });
    } catch (err) {
      setError(authErrorMessage(err));
      setBusy(null);
    }
  }

  return (
    <>
      <PageHeader title={t('auth.title')} onClose={close} />
      <div className="flex flex-col gap-5 px-4 py-5">
        <p className="max-w-[40ch]">{subtitle}</p>
        <Button
          variant="secondary"
          block
          onClick={() => void google()}
          loading={busy === 'google'}
          disabled={busy !== null}
          icon={<GoogleMark />}
        >
          {t('auth.google')}
        </Button>
        <p aria-hidden="true" className="flex items-center gap-3 text-sm text-text-muted">
          <span className="h-px flex-1 bg-border" />
          {t('auth.or')}
          <span className="h-px flex-1 bg-border" />
        </p>
        <form onSubmit={(e) => void submit(e)} noValidate className="flex flex-col gap-4">
          <TextField
            id="auth-email"
            ref={emailRef}
            label={t('auth.email')}
            hint={t('auth.email.hint')}
            error={fieldError}
            type="email"
            autoComplete="email"
            inputMode="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
          {error && <Notice tone="error">{error}</Notice>}
          <Button
            type="submit"
            block
            loading={busy === 'email'}
            disabled={busy !== null}
            icon={<Icon name="mail" />}
          >
            {t('auth.email.send')}
          </Button>
        </form>
      </div>
    </>
  );
}
