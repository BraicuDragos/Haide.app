import { useQuery } from '@tanstack/react-query';
import { getLegal } from '@/api/account';
import { keys } from '@/api/keys';
import { useBack } from '@/app/useBack';
import { t, type MessageKey } from '@/i18n';
import { PageHeader } from '@/ui/PageHeader';

const BODY: Record<'terms' | 'privacy', MessageKey[]> = {
  terms: ['policy.terms.p1', 'policy.terms.p2', 'policy.terms.p3', 'policy.terms.p4'],
  privacy: ['policy.privacy.p1', 'policy.privacy.p2', 'policy.privacy.p3', 'policy.privacy.p4'],
};

/**
 * Policy pages (E6-3), reachable signed out. Content is the versioned placeholder from copy.md 32: the legal text and
 * the controller line come from the owner before launch. The version comes from /legal/current when it answers.
 */
export function PolicyScreen({ kind }: { kind: 'terms' | 'privacy' }) {
  const back = useBack('/profile');
  const legal = useQuery({ queryKey: keys.legal, queryFn: ({ signal }) => getLegal(signal) });
  const version = legal.data?.[kind].version ?? '1.0';
  const title = t(kind === 'terms' ? 'policy.terms.title' : 'policy.privacy.title');
  return (
    <>
      <PageHeader title={title} onBack={back} />
      <article className="flex flex-col gap-4 px-4 py-6">
        <p className="text-sm leading-5 text-text-muted">
          {t('policy.version', { v: version, date: t('policy.effective') })}
        </p>
        {BODY[kind].map((k) => (
          <p key={k} className="max-w-[60ch]">
            {t(k)}
          </p>
        ))}
        <p className="max-w-[60ch] text-sm leading-5 text-text-muted">{t('policy.controller')}</p>
      </article>
    </>
  );
}

export const TermsScreen = () => <PolicyScreen kind="terms" />;
export const PrivacyScreen = () => <PolicyScreen kind="privacy" />;
