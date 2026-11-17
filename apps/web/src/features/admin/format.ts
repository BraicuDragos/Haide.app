import type { MessageKey } from '@/i18n';
import { t } from '@/i18n';

/** How a metric value is shown. Rates arrive as fractions (0.345), so a percentage multiplies by 100. */
export type MetricKind = 'count' | 'percent' | 'minutes' | 'per100';

const trim = (n: number, digits: number) =>
  n.toFixed(digits).replace(/\.0+$|(\.\d*[1-9])0+$/, '$1');

export function formatMetric(kind: MetricKind, v: number | null): string {
  if (v === null) return t('admin.noValue');
  switch (kind) {
    case 'count':
      return String(Math.round(v));
    case 'percent':
      return `${trim(v * 100, 1)} %`;
    case 'minutes':
      return `${trim(v, 1)} min`;
    case 'per100':
      return trim(v, 2);
  }
}

const CORRIDOR_KEYS: Record<string, MessageKey> = {
  south: 'admin.corridor.south',
  west: 'admin.corridor.west',
  campus: 'admin.corridor.campus',
  other: 'admin.corridor.other',
};

export const corridorLabel = (c: string) => t(CORRIDOR_KEYS[c] ?? 'admin.corridor.other');

const REASON_KEYS = {
  no_show: 'report.reason.noShow',
  unsafe_driving: 'report.reason.unsafe',
  harassment: 'report.reason.harassment',
  extra_money: 'report.reason.extraMoney',
  fake_profile: 'report.reason.fake',
  other: 'report.reason.other',
} as const satisfies Record<string, MessageKey>;

export const REASON_CODES = Object.keys(REASON_KEYS) as Array<keyof typeof REASON_KEYS>;
export const reasonLabel = (code: string) =>
  t(REASON_KEYS[code as keyof typeof REASON_KEYS] ?? 'report.reason.other');

const dt = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'Europe/Bucharest',
  day: 'numeric',
  month: 'short',
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
});
/** "17 Nov, 14:05" in Europe/Bucharest. */
export const shortDateTime = (iso: string) => dt.format(new Date(iso));

const d = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'Europe/Bucharest',
  day: 'numeric',
  month: 'short',
  year: 'numeric',
});
export const shortDate = (iso: string) => d.format(new Date(iso));

const ym = new Intl.DateTimeFormat('en-GB', { timeZone: 'UTC', month: 'short', year: 'numeric' });
/** "2026-10" -> "Oct 2026". */
export function memberMonth(value: string): string {
  const [y, m] = value.split('-').map(Number) as [number, number];
  return ym.format(new Date(Date.UTC(y, m - 1, 1)));
}
