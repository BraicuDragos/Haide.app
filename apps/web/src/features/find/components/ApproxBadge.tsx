import { t } from '@/i18n';
import { Icon } from '@/ui/Icon';

/** "Approximate position": an icon plus text (never colour alone) for a synthetic house-number suggestion. */
export function ApproxBadge() {
  return (
    <span className="mt-0.5 inline-flex items-center gap-1 text-sm leading-5 text-text-muted">
      <Icon name="info" small />
      {t('place.approx')}
    </span>
  );
}

/** Calm note under a From/To field whose place has an estimated position. Wire it up with aria-describedby. */
export function ApproxHint({ id, kind }: { id: string; kind: 'from' | 'to' }) {
  return (
    <p id={id} className="flex items-start gap-1.5 text-sm leading-5 text-text-muted">
      <Icon name="info" small className="mt-0.5" />
      {t(kind === 'from' ? 'place.approx.hint.from' : 'place.approx.hint.to')}
    </p>
  );
}
