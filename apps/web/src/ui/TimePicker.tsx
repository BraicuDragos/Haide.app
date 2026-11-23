import { useMemo, useState, type ReactNode, type Ref } from 'react';
import { t } from '@/i18n';
import { fromMinutes, TIME_STEP_MIN, toMinutes } from '@/lib/timeSlots';
import { nearestSlotIndex } from '@/lib/wheel';
import { PickerField } from './PickerField';
import { WheelColon, WheelColumn, WheelSheet } from './WheelPicker';

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

const pad = (n: number) => String(n).padStart(2, '0');
const DEFAULT_START = 8 * 60;

/** What the wheels edit: the hour, the minute (it may be off the step grid: an old value is kept until changed) and
 * the earliest allowed minute of the day, read once when the sheet opens. */
interface Draft {
  h: number;
  m: number;
  min: number;
}

/**
 * 24-hour time field: the shared trigger plus a two-wheel sheet (hours 00-23, minutes on a 5 minute grid) like an
 * alarm clock. The value stays 'HH:MM', so callers keep their parsing. Slots before `minTime` are dimmed and cannot be
 * chosen. A saved time that is off the grid (07:32) stays as it is until the user moves a wheel; the minute wheel
 * only rests on the nearest slot.
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
  const minutes = useMemo(
    () => Array.from({ length: Math.ceil(60 / step) }, (_, i) => i * step),
    [step],
  );

  function init(): Draft {
    const mt = typeof minTime === 'function' ? minTime() : minTime;
    const parsed = mt ? toMinutes(mt) : 0;
    const min = Number.isNaN(parsed) ? 0 : parsed;
    const cur = toMinutes(value);
    // No value yet, or one that is already too early: open on the first sensible slot.
    const first = Math.ceil(min / step) * step;
    const start = Number.isNaN(cur) || cur < min ? Math.max(DEFAULT_START, first) : cur;
    const capped = Math.min(start, 23 * 60 + 59);
    return { h: Math.floor(capped / 60), m: capped % 60, min };
  }

  const at = (d: Draft) => d.h * 60 + d.m;
  const ok = (d: Draft) => d.min < 24 * 60 && at(d) >= d.min;

  return (
    <PickerField
      id={id}
      ref={ref}
      label={label}
      display={value}
      placeholder={t('time.placeholder')}
      icon="clock"
      onOpen={() => setOpen(true)}
      hint={hint}
      error={error}
    >
      <WheelSheet<Draft>
        open={open}
        title={label}
        onClose={() => setOpen(false)}
        init={init}
        summary={(d) => (ok(d) ? fromMinutes(at(d)) : '')}
        isValid={ok}
        confirmLabel={t('time.confirm')}
        onConfirm={(d) => {
          onChange(fromMinutes(at(d)));
          setOpen(false);
        }}
      >
        {(d, setDraft, confirm) => {
          const hourItems = Array.from({ length: 24 }, (_, h) => ({
            value: String(h),
            label: pad(h),
            disabled: h * 60 + 59 < d.min,
          }));
          const minuteItems = minutes.map((m) => ({
            value: String(m),
            label: pad(m),
            disabled: d.h * 60 + m < d.min,
          }));
          // An off-grid minute rests on the nearest slot; the draft keeps the real one until a wheel moves.
          const slot = minutes[nearestSlotIndex(d.m, step, minutes.length)] ?? 0;
          return (
            <>
              <WheelColumn
                id={`${id}-hours`}
                label={t('wheel.hours')}
                items={hourItems}
                value={String(d.h)}
                onEnter={confirm}
                autoFocus
                onChange={(v) =>
                  setDraft((prev) => {
                    const h = Number(v);
                    // A minute that is too early for this hour moves to the first allowed one.
                    const m =
                      h * 60 + prev.m >= prev.min
                        ? prev.m
                        : (minutes.find((x) => h * 60 + x >= prev.min) ?? prev.m);
                    return { ...prev, h, m };
                  })
                }
              />
              <WheelColon />
              <WheelColumn
                id={`${id}-minutes`}
                label={t('wheel.minutes')}
                items={minuteItems}
                value={String(slot)}
                onEnter={confirm}
                onChange={(v) => setDraft((prev) => ({ ...prev, m: Number(v) }))}
              />
            </>
          );
        }}
      </WheelSheet>
    </PickerField>
  );
}
