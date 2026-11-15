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
