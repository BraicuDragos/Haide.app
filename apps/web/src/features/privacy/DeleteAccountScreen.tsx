import { useState } from 'react';
import { useNavigate } from 'react-router';
import { deleteAccount } from '@/api/privacy';
import { useBack } from '@/app/useBack';
import { useScreenHeading } from '@/app/useScreenHeading';
import { useAuth } from '@/auth/AuthProvider';
import { clearIntent } from '@/auth/intent';
import { RequireAuth } from '@/auth/RequireAuth';
import { t, type MessageKey } from '@/i18n';
import { Button } from '@/ui/Button';
import { Icon } from '@/ui/Icon';
import { Notice } from '@/ui/Notice';
import { useToast } from '@/ui/Toast';

const CONSEQUENCES: MessageKey[] = ['delete.l1', 'delete.l2', 'delete.l3'];

/** The keys the consent screen keeps its checkbox drafts under (first consent, updated terms). Dropped with the account. */
const CONSENT_DRAFT_KEYS = ['haide.consentDraft', 'haide.consentUpdateDraft'];

function dropLocalData() {
  try {
    for (const key of CONSENT_DRAFT_KEYS) sessionStorage.removeItem(key);
  } catch {
    /* optional convenience */
  }
}

function Delete() {
  const h1 = useScreenHeading(t('delete.title'));
  const navigate = useNavigate();
  const back = useBack('/profile');
  const { signOut } = useAuth();
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);

  async function confirm() {
    setFailed(false);
    setBusy(true);
    try {
      await deleteAccount();
    } catch {
      setFailed(true);
      setBusy(false);
      return;
    }
    // Leave this screen first (history replaced), then drop the session, cache and the saved share links.
    dropLocalData();
    clearIntent();
    void navigate('/', { replace: true });
    await signOut();
    toast.show(t('delete.toast'));
  }

  return (
    <div className="flex flex-1 flex-col gap-6 px-4 py-8">
      <div className="flex flex-col gap-3">
        <Icon name="alert" className="size-10 text-error" />
        <h1 ref={h1} tabIndex={-1} className="type-h2">
          {t('delete.title')}
        </h1>
        <p className="max-w-[44ch] font-semibold">{t('delete.body')}</p>
      </div>
      <ul className="flex list-none flex-col gap-3">
        {CONSEQUENCES.map((k) => (
          <li key={k} className="card max-w-[48ch] p-4 leading-6">
            {t(k)}
          </li>
        ))}
      </ul>
      {failed && <Notice tone="error">{t('delete.error')}</Notice>}
      <div className="mt-auto flex flex-col gap-3">
        <Button variant="primary" block disabled={busy} onClick={() => back()}>
          {t('delete.keep')}
        </Button>
        <Button variant="danger" block loading={busy} onClick={() => void confirm()}>
          {t('delete.confirm')}
        </Button>
      </div>
    </div>
  );
}

/** Screen 6.4: states the consequences before the one destructive button. Reachable when suspended. */
export default function DeleteAccountScreen() {
  return (
    <RequireAuth title={t('delete.title')}>
      <Delete />
    </RequireAuth>
  );
}
