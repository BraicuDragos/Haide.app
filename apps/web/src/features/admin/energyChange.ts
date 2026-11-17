/**
 * UI mirror of the server's energy price guard (spec 4). The server decides; this only shows the warning early.
 * Integer math throughout, so exactly 30 % passes and 30.01 % does not.
 */
export const LARGE_CHANGE_PCT = 30;

/** Rounded to 0.1 % for display. Null when there is nothing to compare against. */
export function changePct(prev: number | null | undefined, next: number): number | null {
  if (!prev || prev <= 0 || !Number.isFinite(next)) return null;
  return Math.round(((next - prev) * 1000) / prev) / 10;
}

/** |next - prev| x 100 > 30 x prev, integers only. */
export function isLargeChange(prev: number | null | undefined, next: number): boolean {
  if (!prev || prev <= 0 || !Number.isInteger(next) || !Number.isInteger(prev)) return false;
  return Math.abs(next - prev) * 100 > LARGE_CHANGE_PCT * prev;
}

/** "1.234" with `decimals` = 3 -> 1234. Null for anything that is not a plain non-negative decimal within the precision. */
export function parseScaled(input: string, decimals: number): number | null {
  const s = input.trim().replace(',', '.');
  const m = /^(\d{1,6})(?:\.(\d*))?$/.exec(s);
  if (!m) return null;
  const frac = m[2] ?? '';
  if (frac.length > decimals) return null;
  return Number(m[1]) * 10 ** decimals + Number(frac.padEnd(decimals, '0') || '0');
}

/** 1234 with 3 decimals -> "1.234". */
export function formatScaled(value: number, decimals: number): string {
  const whole = Math.trunc(value / 10 ** decimals);
  const frac = String(value % 10 ** decimals).padStart(decimals, '0');
  return `${whole}.${frac}`;
}

export const MILLI = 3;
export const CENTI = 2;
