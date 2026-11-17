import { TIME_ZONE } from '@/lib/format';

/** ISO week helpers (Europe/Bucharest, Monday start). Pure calendar arithmetic on UTC dates, so DST never matters. */
const DAY = 86_400_000;
const WEEK_RE = /^(\d{4})-W(\d{2})$/;

const ymd = new Intl.DateTimeFormat('en-CA', {
  timeZone: TIME_ZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

const utc = (y: number, m: number, d: number) => Date.UTC(y, m - 1, d);
const iso = (ms: number) => new Date(ms).toISOString().slice(0, 10);

/** Monday (as UTC ms) of ISO week 1 of `year`: the week that holds 4 January. */
function week1Monday(year: number): number {
  const jan4 = utc(year, 1, 4);
  const dow = (new Date(jan4).getUTCDay() + 6) % 7; // Monday = 0
  return jan4 - dow * DAY;
}

/** 52 or 53. */
export function weeksInYear(year: number): number {
  return Math.round((week1Monday(year + 1) - week1Monday(year)) / (7 * DAY));
}

/** "2026-W47" -> Monday "2026-11-16". Null for anything that is not a real ISO week (2027-W53, W00, junk). */
export function parseIsoWeek(week: string): string | null {
  const m = WEEK_RE.exec(week);
  if (!m) return null;
  const year = Number(m[1]);
  const n = Number(m[2]);
  if (n < 1 || n > weeksInYear(year)) return null;
  return iso(week1Monday(year) + (n - 1) * 7 * DAY);
}

/** Any "YYYY-MM-DD" maps to the ISO week it falls in, e.g. "2026-W47". */
export function isoWeekOf(day: string): string {
  const [y, m, d] = day.split('-').map(Number) as [number, number, number];
  const ms = utc(y, m, d);
  const dow = (new Date(ms).getUTCDay() + 6) % 7;
  const thursday = ms - dow * DAY + 3 * DAY; // the Thursday decides the ISO year
  const year = new Date(thursday).getUTCFullYear();
  const n = Math.floor((thursday - week1Monday(year)) / (7 * DAY)) + 1;
  return `${year}-W${String(n).padStart(2, '0')}`;
}

/** The ISO week that holds `now` on the Bucharest calendar. */
export function currentIsoWeek(now: Date = new Date()): string {
  return isoWeekOf(ymd.format(now));
}

/** `delta` weeks later (negative: earlier), across year ends. */
export function addWeeks(week: string, delta: number): string {
  const monday = parseIsoWeek(week);
  if (!monday) return week;
  const [y, m, d] = monday.split('-').map(Number) as [number, number, number];
  return isoWeekOf(iso(utc(y, m, d) + delta * 7 * DAY));
}

/** Weeks compare as strings because the format is fixed width. */
export const compareWeeks = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

const MONTH = new Intl.DateTimeFormat('en-GB', { timeZone: 'UTC', month: 'short' });
const part = (ms: number) => ({
  d: new Date(ms).getUTCDate(),
  m: MONTH.format(new Date(ms)),
  y: new Date(ms).getUTCFullYear(),
});

/** "Week 47 · 16–22 Nov 2026" (spec 7.1). Crossing a month or a year shows both ends. */
export function weekLabel(week: string): string {
  const monday = parseIsoWeek(week);
  if (!monday) return week;
  const [y, m, d] = monday.split('-').map(Number) as [number, number, number];
  const from = part(utc(y, m, d));
  const to = part(utc(y, m, d) + 6 * DAY);
  const n = Number(week.slice(6));
  let range: string;
  if (from.y !== to.y) range = `${from.d} ${from.m} ${from.y}–${to.d} ${to.m} ${to.y}`;
  else if (from.m !== to.m) range = `${from.d} ${from.m}–${to.d} ${to.m} ${to.y}`;
  else range = `${from.d}–${to.d} ${to.m} ${to.y}`;
  return `Week ${n} · ${range}`;
}

/** Short label for the sparkline table: "W47". */
export const shortWeek = (week: string) => `W${week.slice(6)}`;
