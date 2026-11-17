import { t } from '@/i18n';
import { Icon } from '@/ui/Icon';
import { addWeeks, compareWeeks, weekLabel } from '../isoWeek';

interface Props {
  week: string;
  /** First week with data (spec: 2026-W46). */
  min: string;
  /** The current week. */
  max: string;
  onChange: (week: string) => void;
}

const STEP =
  'grid size-12 flex-none place-items-center rounded-full hover:bg-surface-subtle disabled:opacity-40';

/** Previous / next week plus "This week". The label is a polite live region so a screen reader hears the new week. */
export function WeekPicker({ week, min, max, onChange }: Props) {
  const atMin = compareWeeks(week, min) <= 0;
  const atMax = compareWeeks(week, max) >= 0;
  return (
    <div className="flex flex-wrap items-center gap-2">
      <button
        type="button"
        className={STEP}
        disabled={atMin}
        aria-label={t('admin.metrics.prevWeek')}
        onClick={() => onChange(addWeeks(week, -1))}
      >
        <Icon name="back" />
      </button>
      <p
        aria-live="polite"
        className="type-label order-first basis-full text-center sm:order-none sm:basis-0 sm:flex-1"
      >
        {weekLabel(week)}
      </p>
      <button
        type="button"
        className={STEP}
        disabled={atMax}
        aria-label={t('admin.metrics.nextWeek')}
        onClick={() => onChange(addWeeks(week, 1))}
      >
        <Icon name="chev" />
      </button>
      <button
        type="button"
        className="btn btn-secondary ml-auto"
        disabled={week === max}
        onClick={() => onChange(max)}
      >
        {t('admin.metrics.thisWeek')}
      </button>
    </div>
  );
}
