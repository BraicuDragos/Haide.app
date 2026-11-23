import { bucharestToday } from './dates';
import { TIME_ZONE } from './format';

export const TIME_STEP_MIN = 5;

const clock = new Intl.DateTimeFormat('en-GB', {
  timeZone: TIME_ZONE,
  hourCycle: 'h23',
  hour: '2-digit',
  minute: '2-digit',
});

/** 'HH:MM' (or '24:00') to minutes since midnight; NaN for anything else. */
export function toMinutes(time: string): number {
  const m = /^(\d{2}):(\d{2})$/.exec(time);
  return m ? Number(m[1]) * 60 + Number(m[2]) : NaN;
}

export function fromMinutes(min: number): string {
  const h = Math.floor(min / 60);
  return `${String(h).padStart(2, '0')}:${String(min % 60).padStart(2, '0')}`;
}

/**
 * Earliest selectable time on `day` (Europe/Bucharest) for a departure `leadMs` from now, rounded up to the step.
 * `undefined`: the day is far enough ahead, nothing is disabled. '24:00': the whole day is already too early.
 */
export function minTimeFor(
  day: string,
  leadMs: number,
  step = TIME_STEP_MIN,
  now: Date = new Date(),
): string | undefined {
  const target = new Date(now.getTime() + leadMs);
  const targetDay = bucharestToday(target);
  if (targetDay < day) return undefined;
  if (targetDay > day) return '24:00';
  const parts = clock.format(target).split(':');
  const mins = Number(parts[0]) * 60 + Number(parts[1]);
  return fromMinutes(Math.ceil(mins / step) * step);
}
