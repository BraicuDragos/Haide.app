import { useQuery } from '@tanstack/react-query';
import { useBack } from '@/app/useBack';
import { loadPolicy, type PolicyKind } from '@/features/policy/content';
import { t } from '@/i18n';
import { longDate } from '@/lib/dates';
import { Button } from '@/ui/Button';
import { Loader } from '@/ui/Loader';
import { Notice } from '@/ui/Notice';
import { PageHeader } from '@/ui/PageHeader';

/**
 * Policy pages (E6-3), reachable signed out. The versioned text is a lazy chunk (content/*.en.ts): version and date
 * come from the file, so the page always shows the text it contains. Contents list jumps to sections with plain
 * anchors (no smooth scrolling, so nothing to switch off for reduced motion).
 */
export function PolicyScreen({ kind }: { kind: PolicyKind }) {
  const back = useBack('/profile');
  const doc = useQuery({
    queryKey: ['policy', kind],
    queryFn: () => loadPolicy(kind),
    staleTime: Infinity,
  });
  const title = t(kind === 'terms' ? 'policy.terms.title' : 'policy.privacy.title');

  return (
    <>
      <PageHeader title={title} onBack={back} />
      {doc.isPending && (
        <div aria-busy="true">
          <Loader />
        </div>
      )}
      {doc.isError && (
        <div className="flex flex-col gap-4 p-4">
          <Notice tone="error">{t('policy.loadError')}</Notice>
          <Button variant="secondary" block onClick={() => void doc.refetch()}>
            {t('common.retry')}
          </Button>
        </div>
      )}
      {doc.data && (
        <article className="flex flex-col gap-6 px-4 py-6">
          <p className="text-sm leading-5 text-text-muted">
            {t('policy.version', {
              v: doc.data.version,
              date: longDate(doc.data.effectiveDate),
            })}
          </p>
          <nav aria-labelledby="policy-toc" className="card flex flex-col gap-1 p-4">
            <h2 id="policy-toc" className="type-h3">
              {t('policy.toc')}
            </h2>
            <ol className="flex list-none flex-col">
              {doc.data.sections.map((s, i) => (
                <li key={s.id}>
                  <a
                    href={`#${kind}-${s.id}`}
                    className="flex min-h-11 items-center gap-2 font-semibold text-link underline"
                  >
                    <span className="w-6 text-text-muted tabular-nums" aria-hidden="true">
                      {i + 1}.
                    </span>
                    {s.title}
                  </a>
                </li>
              ))}
            </ol>
          </nav>
          {doc.data.sections.map((s, i) => (
            <section key={s.id} aria-labelledby={`${kind}-${s.id}`} className="flex flex-col gap-3">
              <h2 id={`${kind}-${s.id}`} tabIndex={-1} className="type-h3 scroll-mt-16">
                {i + 1}. {s.title}
              </h2>
              {s.body.map((p) => (
                <p key={p} className="max-w-[60ch]">
                  {p}
                </p>
              ))}
            </section>
          ))}
        </article>
      )}
    </>
  );
}

export const TermsScreen = () => <PolicyScreen kind="terms" />;
export const PrivacyScreen = () => <PolicyScreen kind="privacy" />;
