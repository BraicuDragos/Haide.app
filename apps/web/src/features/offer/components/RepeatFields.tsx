import type { Weekday } from '@/api/liquidity';
import { t, tp } from '@/i18n';
import { WEEKDAYS } from '@/lib/seriesDates';
import { TextField } from '@/ui/Field';
import { Icon } from '@/ui/Icon';

export interface RepeatValue {
  on: boolean;
  weekdays: Weekday[];
  until: string;
}

interface Props {
  value: RepeatValue;
  onChange: (next: RepeatValue) => void;
  /** Latest allowed end date (today + 28 days) and how many rides the current choice creates. */
  maxUntil: string;
  minUntil: string;
  count: number;
  /** The weekday of the chosen first day: pre-selected when the switch goes on. */
  firstWeekday: Weekday;
  error?: string | undefined;
}

/**
 * "Repeat on weekdays" (E8-1): a switch that reveals weekday toggle chips (aria-pressed), an "Until" date and a live
 * "Creates n rides" line. The server decides the final set (daily limit, clock changes); this only mirrors the rules.
 */
export function RepeatFields({
  value,
  onChange,
  maxUntil,
  minUntil,
  count,
  firstWeekday,
  error,
}: Props) {
  const toggle = (d: Weekday) =>
    onChange({
      ...value,
      weekdays: value.weekdays.includes(d)
        ? value.weekdays.filter((x) => x !== d)
        : [...value.weekdays, d].sort((a, b) => a - b),
    });

  return (
    <section aria-labelledby="offer-repeat-h" className="flex flex-col gap-3">
      <div className="flex min-h-12 items-center justify-between gap-3">
        <label htmlFor="offer-repeat" className="flex flex-1 flex-wrap items-center gap-x-2">
          <span id="offer-repeat-h" className="type-label">
            {t('offer.repeat')}
          </span>
        </label>
        <input
          id="offer-repeat"
          type="checkbox"
          role="switch"
          className="switch"
          checked={value.on}
          onChange={(e) =>
            onChange({
              ...value,
              on: e.target.checked,
              weekdays: value.weekdays.length ? value.weekdays : [firstWeekday],
            })
          }
        />
      </div>

      {value.on && (
        <div className="card flex flex-col gap-4 p-4">
          <fieldset className="m-0 flex min-w-0 flex-col gap-2 border-0 p-0">
            <legend className="type-label mb-1 p-0">{t('offer.repeat.days')}</legend>
            <div className="flex flex-wrap gap-2">
              {WEEKDAYS.map((d) => (
                <button
                  key={d}
                  type="button"
                  className="chip"
                  aria-pressed={value.weekdays.includes(d)}
                  onClick={() => toggle(d)}
                >
                  {t(`weekday.${d}.short`)}
                </button>
              ))}
            </div>
          </fieldset>
          <TextField
            id="offer-until"
            type="date"
            label={t('offer.repeat.until')}
            hint={t('offer.repeat.until.hint')}
            min={minUntil}
            max={maxUntil}
            value={value.until}
            onChange={(e) => onChange({ ...value, until: e.target.value })}
          />
          <p aria-live="polite" className="font-semibold text-savings">
            {count > 0 ? tp('offer.repeat.count', count) : ''}
          </p>
          {error && (
            <p
              id="offer-repeat-err"
              role="alert"
              className="flex items-start gap-1.5 text-sm leading-5 font-semibold text-error"
            >
              <Icon name="alert" small className="mt-0.5" />
              {error}
            </p>
          )}
        </div>
      )}
    </section>
  );
}
