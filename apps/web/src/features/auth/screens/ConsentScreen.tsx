import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState, type FormEvent, type ReactNode, type Ref } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router';
import { getLegal, getMe, postConsents } from '@/api/account';
import { ApiError } from '@/api/client';
import { keys } from '@/api/keys';
import { useSignOut, useAdvance, useMe } from '@/auth/hooks';
import { safePath } from '@/auth/intent';
import { destination } from '@/auth/onboarding';
import { RequireAuth, ScreenSkeleton } from '@/auth/RequireAuth';
import { loadPolicy } from '@/features/policy/content';
import { StepProgress } from '@/features/onboarding/StepProgress';
import { t, tError } from '@/i18n';
import type { Me } from '@/api/types';
import { Button } from '@/ui/Button';
import { Icon } from '@/ui/Icon';
import { Notice } from '@/ui/Notice';
import { PageHeader } from '@/ui/PageHeader';

const DRAFT_KEY = 'haide.consentDraft';

/** The boxes survive a trip to the policy pages (ia-and-flows 1.3). Nothing is stored once consent is sent. */
function readDraft(): { age: boolean; terms: boolean } {
  try {
    const v = JSON.parse(sessionStorage.getItem(DRAFT_KEY) ?? '{}') as Record<string, unknown>;
    return { age: v.age === true, terms: v.terms === true };
  } catch {
    return { age: false, terms: false };
  }
}

function Check({
  id,
  checked,
  onChange,
  error,
  children,
  inputRef,
}: {
  id: string;
  checked: boolean;
  onChange: (v: boolean) => void;
  error: string | undefined;
  children: ReactNode;
  inputRef?: Ref<HTMLInputElement>;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <div
        className={`flex min-h-12 items-start gap-3 rounded-md bg-bg-deep p-3 ${error ? 'border-2 border-error' : 'border border-border-strong'}`}
      >
        <input
          id={id}
          ref={inputRef}
          type="checkbox"
          checked={checked}
          onChange={(e) => onChange(e.target.checked)}
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? `${id}-err` : undefined}
          className="mt-0.5 size-6 flex-none accent-action"
        />
        <label htmlFor={id} className="min-h-6 flex-1 leading-6">
          {children}
        </label>
      </div>
      {error && (
        <p
          id={`${id}-err`}
          role="alert"
          className="flex items-start gap-1.5 text-sm leading-5 font-semibold text-error"
        >
          <Icon name="alert" small className="mt-0.5" />
          {error}
        </p>
      )}
    </div>
  );
}

function Consent() {
  const advance = useAdvance();
  const signOut = useSignOut();
  const me = useMe();
  const legal = useQuery({ queryKey: keys.legal, queryFn: ({ signal }) => getLegal(signal) });
  const [draft] = useState(readDraft);
  const [age, setAge] = useState(draft.age);
  const [terms, setTerms] = useState(draft.terms);
  const [errors, setErrors] = useState<{ age?: string; terms?: string }>({});
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);
  const ageRef = useRef<HTMLInputElement>(null);
  const termsRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    try {
      sessionStorage.setItem(DRAFT_KEY, JSON.stringify({ age, terms }));
    } catch {
      /* optional convenience */
    }
  }, [age, terms]);

  // Nothing to accept (already consented to the current versions): move on.
  const arrived = useRef(false);
  useEffect(() => {
    if (!me.data || arrived.current) return;
    arrived.current = true;
    if (me.data.consent.upToDate) void advance(me.data);
  }, [me.data, advance]);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(undefined);
    const next = {
      age: age ? undefined : t('consent.err.age'),
      terms: terms ? undefined : t('consent.err.terms'),
    };
    setErrors(next);
    if (next.age) return ageRef.current?.focus();
    if (next.terms) return termsRef.current?.focus();
    if (!legal.data) return setError(t('consent.err.load'));
    setBusy(true);
    try {
      await postConsents({
        age18: true,
        termsVersion: legal.data.terms.version,
        privacyVersion: legal.data.privacy.version,
      });
      try {
        sessionStorage.removeItem(DRAFT_KEY);
      } catch {
        /* ignore */
      }
      await advance();
    } catch (err) {
      setError(tError(err instanceof ApiError ? err.code : undefined));
      setBusy(false);
    }
  }

  if (me.isPending || me.data?.consent.upToDate)
    return <ScreenSkeleton title={t('consent.title')} />;

  return (
    <>
      <PageHeader title={t('consent.title')} />
      <form onSubmit={(e) => void submit(e)} noValidate className="flex flex-col gap-5 px-4 py-5">
        <StepProgress current="agreement" />
        <p className="max-w-[44ch]">{t('consent.body')}</p>
        <Check
          id="consent-age"
          inputRef={ageRef}
          checked={age}
          onChange={setAge}
          error={errors.age}
        >
          {t('consent.age')}
        </Check>
        <Check
          id="consent-terms"
          inputRef={termsRef}
          checked={terms}
          onChange={setTerms}
          error={errors.terms}
        >
          {t('consent.terms.pre')}
          <Link to="/policy/terms" className="font-semibold text-link underline">
            {t('consent.terms.tos')}
          </Link>
          {t('consent.terms.and')}
          <Link to="/policy/privacy" className="font-semibold text-link underline">
            {t('consent.terms.pp')}
          </Link>
        </Check>
        {(error || legal.isError) && <Notice tone="error">{error ?? t('consent.err.load')}</Notice>}
        <div className="flex flex-col gap-2">
          <Button type="submit" block loading={busy}>
            {t('consent.cta')}
          </Button>
          <Button variant="ghost" block disabled={busy} onClick={() => void signOut()}>
            {t('consent.decline')}
          </Button>
        </div>
      </form>
    </>
  );
}

const UPDATE_DRAFT_KEY = 'haide.consentUpdateDraft';

/**
 * Screen 1.3b: terms or privacy changed since the person accepted. Shows what changed, links to both documents and asks
 * for one checkbox (age is already on record). Accepting goes back to where the Shell interrupted them.
 */
function UpdatedTerms() {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const signOut = useSignOut();
  const [params] = useSearchParams();
  const requested = params.get('returnTo');
  const returnTo = safePath(requested) && !requested.startsWith('/auth') ? requested : '/find';
  const legal = useQuery({ queryKey: keys.legal, queryFn: ({ signal }) => getLegal(signal) });
  const changes = useQuery({
    queryKey: ['policy', 'changes'],
    staleTime: Infinity,
    queryFn: async () => {
      const [terms, privacy] = await Promise.all([loadPolicy('terms'), loadPolicy('privacy')]);
      return { terms: terms.changes, privacy: privacy.changes };
    },
  });
  const [accepted, setAccepted] = useState(() => {
    try {
      return sessionStorage.getItem(UPDATE_DRAFT_KEY) === '1';
    } catch {
      return false;
    }
  });
  const [err, setErr] = useState<string>();
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);
  const boxRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    try {
      sessionStorage.setItem(UPDATE_DRAFT_KEY, accepted ? '1' : '0');
    } catch {
      /* optional convenience */
    }
  }, [accepted]);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(undefined);
    if (!accepted) {
      setErr(t('consent.update.err'));
      return boxRef.current?.focus();
    }
    setErr(undefined);
    if (!legal.data) return setError(t('consent.err.load'));
    setBusy(true);
    try {
      await postConsents({
        termsVersion: legal.data.terms.version,
        privacyVersion: legal.data.privacy.version,
      });
      try {
        sessionStorage.removeItem(UPDATE_DRAFT_KEY);
      } catch {
        /* ignore */
      }
      const me = await qc.fetchQuery<Me>({
        queryKey: keys.me,
        queryFn: () => getMe(),
        staleTime: 0,
      });
      qc.setQueryData(keys.me, me);
      void navigate(destination(me, { kind: 'other', returnTo }), { replace: true });
    } catch (e2) {
      setError(tError(e2 instanceof ApiError ? e2.code : undefined));
      setBusy(false);
    }
  }

  const lists = [
    { key: 'terms', title: t('policy.terms.title'), items: changes.data?.terms },
    { key: 'privacy', title: t('policy.privacy.title'), items: changes.data?.privacy },
  ];

  return (
    <>
      <PageHeader title={t('consent.update.title')} />
      <form onSubmit={(e) => void submit(e)} noValidate className="flex flex-col gap-5 px-4 py-5">
        <p className="max-w-[44ch]">{t('consent.update.body')}</p>
        <section aria-labelledby="changes-h" className="card flex flex-col gap-4 p-4">
          <h2 id="changes-h" className="type-h3">
            {t('consent.update.changes')}
          </h2>
          {changes.isPending && <p className="text-text-muted">{t('a11y.loading')}</p>}
          {changes.isError && <Notice tone="error">{t('policy.loadError')}</Notice>}
          {lists.map(
            (l) =>
              l.items && (
                <div key={l.key} className="flex flex-col gap-2">
                  <h3 className="font-semibold">{l.title}</h3>
                  <ul className="flex list-disc flex-col gap-1.5 pl-5 leading-6 text-text-muted">
                    {l.items.map((c) => (
                      <li key={c}>{c}</li>
                    ))}
                  </ul>
                </div>
              ),
          )}
          <div className="flex flex-col">
            <Link
              to="/policy/terms"
              className="flex min-h-11 items-center font-semibold text-link underline"
            >
              {t('consent.update.readTerms')}
            </Link>
            <Link
              to="/policy/privacy"
              className="flex min-h-11 items-center font-semibold text-link underline"
            >
              {t('consent.update.readPrivacy')}
            </Link>
          </div>
        </section>
        <Check
          id="consent-update"
          inputRef={boxRef}
          checked={accepted}
          onChange={setAccepted}
          error={err}
        >
          {t('consent.update.accept')}
        </Check>
        {(error || legal.isError) && <Notice tone="error">{error ?? t('consent.err.load')}</Notice>}
        <div className="flex flex-col gap-2">
          <Button type="submit" block loading={busy}>
            {t('consent.cta')}
          </Button>
          <Link to="/delete" className="btn btn-ghost btn-block">
            {t('consent.update.delete')}
          </Link>
          <Button variant="ghost" block disabled={busy} onClick={() => void signOut()}>
            {t('consent.update.signOut')}
          </Button>
        </div>
      </form>
    </>
  );
}

function ConsentRoute() {
  const me = useMe();
  // Once the update mode has shown, it stays: accepting flips `reaccept` off before the screen navigates away, and the
  // first-time flow must not take over in between.
  const update = useRef(false);
  if (me.data?.consent.reaccept === true) update.current = true;
  return update.current ? <UpdatedTerms /> : <Consent />;
}

/** Screen 1.3: 18+ and Terms/Privacy, two separate errors. Decline signs out (ADR 0010). Updated terms: 1.3b. */
export function ConsentScreen() {
  return (
    <RequireAuth title={t('consent.title')} keepIntent>
      <ConsentRoute />
    </RequireAuth>
  );
}
