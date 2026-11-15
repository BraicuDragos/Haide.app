import { t } from '@/i18n';

export const TIME_ZONE = 'Europe/Bucharest';

/** Money is always integer bani. 390 -> "3.90 RON". Never takes floats. */
export function formatRon(bani: number): string {
  if (!Number.isInteger(bani)) throw new RangeError('formatRon expects integer bani');
  const sign = bani < 0 ? '-' : '';
  const abs = Math.abs(bani);
  const whole = Math.floor(abs / 100);
  const frac = String(abs % 100).padStart(2, '0');
  return `${sign}${whole}.${frac} RON`;
}

const timeFmt = new Intl.DateTimeFormat('en-GB', {
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
  timeZone: TIME_ZONE,
});

/** ISO 8601 UTC -> "07:30" in Europe/Bucharest, 24 h. */
export function formatTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) throw new RangeError('formatTime expects an ISO date');
  return timeFmt.format(d);
}

/** Walking distance: "150 m", or "1.2 km" from 1000 m up. Server already rounds to 50 m. */
export function formatWalk(m: number): string {
  if (m < 1000) return t('common.m', { n: Math.round(m) });
  const km = Math.round(m / 100) / 10;
  return t('common.km', { n: km.toFixed(1).replace(/\.0$/, '') });
}
