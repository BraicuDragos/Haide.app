import { t } from '@/i18n';
import { TIME_ZONE } from './format';

const ymd = new Intl.DateTimeFormat('en-CA', {
  timeZone: TIME_ZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});
const label = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'UTC',
  weekday: 'short',
  day: 'numeric',
  month: 'short',
});

/** Calendar day in Europe/Bucharest as YYYY-MM-DD. */
export function bucharestToday(now: Date = new Date()): string {
  return ymd.format(now);
}

export interface DayOption {
  value: string; // YYYY-MM-DD, interpreted in Europe/Bucharest by the API
  label: string;
}

/** Today, Tomorrow, then dated weekdays, `count` days in total. Pure calendar arithmetic, DST-safe. */
export function dayOptions(count = 7, now: Date = new Date()): DayOption[] {
  const [y, m, d] = bucharestToday(now).split('-').map(Number) as [number, number, number];
  return Array.from({ length: count }, (_, i) => {
    const dt = new Date(Date.UTC(y, m - 1, d + i));
    const value = dt.toISOString().slice(0, 10);
    const text = i === 0 ? t('common.today') : i === 1 ? t('common.tomorrow') : label.format(dt);
    return { value, label: text };
  });
}

const wall = new Intl.DateTimeFormat('en-US', {
  timeZone: TIME_ZONE,
  hourCycle: 'h23',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
});

/** Europe/Bucharest wall clock of an instant, read back as if it were UTC (for offset arithmetic). */
function wallAsUtc(ms: number): number {
  const p = Object.fromEntries(wall.formatToParts(new Date(ms)).map((x) => [x.type, x.value]));
  return Date.UTC(+p.year!, +p.month! - 1, +p.day!, +p.hour!, +p.minute!);
}

/**
 * "2026-11-16" + "07:30" in Europe/Bucharest -> ISO UTC ("2026-11-16T05:30:00.000Z"). DST-safe: the offset is read
 * from Intl at the target instant, so the browser's own time zone never matters.
 */
export function bucharestToIso(day: string, time: string): string {
  const [y, m, d] = day.split('-').map(Number) as [number, number, number];
  const [hh, mm] = time.split(':').map(Number) as [number, number];
  const target = Date.UTC(y, m - 1, d, hh, mm);
  let ms = target - (wallAsUtc(target) - target);
  ms = target - (wallAsUtc(ms) - ms); // second pass settles instants next to a DST change
  return new Date(ms).toISOString();
}

/** "Today", "Tomorrow", or "Mon 17 Nov" for an instant, by Europe/Bucharest calendar day. */
export function dayLabel(iso: string, now: Date = new Date()): string {
  const d = new Date(iso);
  const [y, m, dd] = ymd.format(d).split('-').map(Number) as [number, number, number];
  const [ny, nm, nd] = bucharestToday(now).split('-').map(Number) as [number, number, number];
  const diff = Math.round((Date.UTC(y, m - 1, dd) - Date.UTC(ny, nm - 1, nd)) / 86_400_000);
  if (diff === 0) return t('common.today');
  if (diff === 1) return t('common.tomorrow');
  return label.format(new Date(Date.UTC(y, m - 1, dd)));
}

/** "Mon 17 Nov" for a YYYY-MM-DD calendar day (never "Today"): for messages that name a date. */
export function dateLabel(day: string): string {
  const [y, m, d] = day.split('-').map(Number) as [number, number, number];
  return label.format(new Date(Date.UTC(y, m - 1, d)));
}
