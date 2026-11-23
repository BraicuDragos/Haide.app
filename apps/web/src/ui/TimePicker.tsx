import { useEffect, useRef, useState, type KeyboardEvent, type ReactNode, type Ref } from 'react';
import { t } from '@/i18n';
import { fromMinutes, TIME_STEP_MIN, toMinutes } from '@/lib/timeSlots';
import { Button } from './Button';
import { Icon } from './Icon';
import { Sheet } from './Sheet';

interface Props {
  id: string;
  label: string;
  /** 'HH:MM' (24 h) or '' when nothing is chosen yet. */
  value: string;
  onChange: (value: string) => void;
  hint?: ReactNode;
  error?: string | undefined;
  /** Earliest selectable time ('HH:MM', or '24:00' for none): earlier slots are disabled. A function is read whenever
   * the sheet opens, so "now" is never stale. */
  minTime?: string | undefined | (() => string | undefined);
  /** Minute step, default 5. */
  step?: number;
  ref?: Ref<HTMLButtonElement>;
}

const COLS = 6;
const pad = (n: number) => String(n).padStart(2, '0');

/**
 * 24-hour time field: a field-like button that opens the Sheet with an hour grid and a minute grid (big touch
 * targets, no wheel and no native clock). The value stays 'HH:MM', so callers keep their parsing. Hours and minutes
 * are two radio groups: arrow keys move inside a group, Esc closes the sheet and focus returns to the button.
 */
export function TimePicker({
  id,
  label,
  value,
  onChange,
  hint,
  error,
  minTime,
  step = TIME_STEP_MIN,
  ref,
}: Props) {
  const [open, setOpen] = useState(false);
  const hintId = `${id}-hint`;
  const errId = `${id}-err`;
  const describedBy =
    [hint ? hintId : '', error ? errId : ''].filter(Boolean).join(' ') || undefined;
  return (
    <div className="flex min-w-0 flex-col gap-1">
      <span id={`${id}-label`} className="type-label">
        {label}
      </span>
      <button
        id={id}
        ref={ref}
        type="button"
        aria-haspopup="dialog"
        aria-labelledby={`${id}-label ${id}-value`}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy}
        onClick={() => setOpen(true)}
        className={`control flex min-h-12 items-center justify-between gap-2 text-left ${error ? 'border-2 border-error' : 'border border-border-strong'}`}
      >
        <span
          id={`${id}-value`}
          className={`min-w-0 truncate ${value ? 'tabular-nums' : 'text-text-muted'}`}
        >
          {value || t('time.placeholder')}
        </span>
        <Icon name="clock" small />
      </button>
      {hint && (
        <p id={hintId} className="text-sm leading-5 text-text-muted">
          {hint}
        </p>
      )}
      {error && (
        <p
          id={errId}
          role="alert"
          className="flex items-start gap-1.5 text-sm leading-5 font-semibold text-error"
        >
          <Icon name="alert" small className="mt-0.5" />
          {error}
        </p>
      )}
      <Sheet open={open} title={label} onClose={() => setOpen(false)}>
        <Panel
          value={value}
          minTime={typeof minTime === 'function' ? minTime() : minTime}
          step={step}
          onCancel={() => setOpen(false)}
          onConfirm={(v) => {
            onChange(v);
            setOpen(false);
          }}
        />
      </Sheet>
    </div>
  );
}

function Panel({
  value,
  minTime,
  step,
  onCancel,
  onConfirm,
}: {
  value: string;
  minTime: string | undefined;
  step: number;
  onCancel: () => void;
  onConfirm: (v: string) => void;
}) {
  const initial = toMinutes(value);
  const [hour, setHour] = useState<number | null>(
    Number.isNaN(initial) ? null : Math.floor(initial / 60),
  );
  const [minute, setMinute] = useState<number | null>(Number.isNaN(initial) ? null : initial % 60);
  const hourRef = useRef<HTMLDivElement>(null);

  const min = minTime ? toMinutes(minTime) : 0;
  const minutes = Array.from({ length: Math.ceil(60 / step) }, (_, i) => i * step);
  const hourOk = (h: number) => h * 60 + 59 >= min && minutes.some((m) => h * 60 + m >= min);
  const minuteOk = (h: number | null, m: number) => h === null || h * 60 + m >= min;
  const hours = Array.from({ length: 24 }, (_, i) => i);

  // Open on the chosen hour so keyboard users land in the grid.
  useEffect(() => {
    const el =
      hourRef.current?.querySelector<HTMLElement>('[aria-checked="true"]') ??
      hourRef.current?.querySelector<HTMLElement>('[role="radio"]:not(:disabled)');
    // The dialog is opened by Sheet's own effect, which runs after this one: focus once it is open.
    queueMicrotask(() => el?.focus());
  }, []);

  function pickHour(h: number) {
    setHour(h);
    // A minute that is too early for this hour moves to the first allowed one; none chosen yet starts at the first.
    if (minute === null || !minuteOk(h, minute)) {
      setMinute(minutes.find((m) => minuteOk(h, m)) ?? null);
    }
  }

  const ready = hour !== null && minute !== null && minuteOk(hour, minute);

  return (
    <>
      <Group
        label={t('time.hour')}
        items={hours}
        selected={hour}
        isOk={hourOk}
        text={pad}
        onPick={pickHour}
        groupRef={hourRef}
      />
      <Group
        label={t('time.minute')}
        items={minutes}
        selected={minute}
        isOk={(m) => minuteOk(hour, m)}
        text={pad}
        onPick={setMinute}
      />
      <p className="type-numeral-sm text-center tabular-nums" aria-live="polite">
        {ready ? fromMinutes(hour * 60 + minute) : '--:--'}
      </p>
      <div className="mt-auto grid grid-cols-2 gap-3">
        <Button variant="secondary" onClick={onCancel}>
          {t('time.cancel')}
        </Button>
        <Button
          disabled={!ready}
          onClick={() => ready && onConfirm(fromMinutes(hour * 60 + minute))}
        >
          {t('time.confirm')}
        </Button>
      </div>
    </>
  );
}

function Group({
  label,
  items,
  selected,
  isOk,
  text,
  onPick,
  groupRef,
}: {
  label: string;
  items: number[];
  selected: number | null;
  isOk: (n: number) => boolean;
  text: (n: number) => string;
  onPick: (n: number) => void;
  groupRef?: Ref<HTMLDivElement>;
}) {
  const enabled = items.filter(isOk);
  // Roving tabindex: the chosen item, else the first enabled one, is the group's single tab stop.
  const stop = selected !== null && isOk(selected) ? selected : enabled[0];

  function onKey(e: KeyboardEvent<HTMLDivElement>) {
    const cur = items.indexOf(Number((document.activeElement as HTMLElement | null)?.dataset.v));
    if (cur < 0) return;
    const dir: Record<string, number> = {
      ArrowRight: 1,
      ArrowDown: COLS,
      ArrowLeft: -1,
      ArrowUp: -COLS,
    };
    let next = -1;
    if (e.key in dir) {
      const d = dir[e.key]!;
      for (let i = cur + d; i >= 0 && i < items.length; i += d) {
        if (isOk(items[i]!)) {
          next = i;
          break;
        }
      }
      if (next < 0) next = cur;
    } else if (e.key === 'Home') next = items.findIndex(isOk);
    else if (e.key === 'End') next = items.length - 1 - [...items].reverse().findIndex(isOk);
    else return;
    e.preventDefault();
    const v = items[next];
    if (v === undefined) return;
    onPick(v);
    (e.currentTarget.querySelector(`[data-v="${v}"]`) as HTMLElement | null)?.focus();
  }

  return (
    <div className="flex flex-col gap-2">
      <p className="type-label" aria-hidden="true">
        {label}
      </p>
      <div
        ref={groupRef}
        role="radiogroup"
        aria-label={label}
        onKeyDown={onKey}
        className="grid grid-cols-6 gap-2"
      >
        {items.map((n) => {
          const on = n === selected;
          return (
            <button
              key={n}
              type="button"
              role="radio"
              aria-checked={on}
              data-v={n}
              disabled={!isOk(n)}
              tabIndex={n === stop ? 0 : -1}
              onClick={() => onPick(n)}
              className="chip min-w-0 justify-center px-0 tabular-nums focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-(--theme-focus-ring) aria-checked:border-outline aria-checked:bg-tint aria-checked:text-on-tint disabled:cursor-not-allowed disabled:opacity-40"
            >
              {text(n)}
            </button>
          );
        })}
      </div>
    </div>
  );
}
