/**
 * Client-side mirrors of the server rules, for instant feedback only. The API is the authority (conventions 4):
 * server `fields` errors are shown too. Diacritics are plain Unicode letters (Ștefan, Țepeș).
 */

/** Unicode letters (with combining marks), optionally joined by single spaces, hyphens or apostrophes. 1 to 30 chars. */
const NAME_RE = /^\p{L}[\p{L}\p{M}]*(?:[ '’-]\p{L}[\p{L}\p{M}]*)*$/u;

export function isValidFirstName(raw: string): boolean {
  const v = raw.trim();
  return v.length >= 1 && v.length <= 30 && NAME_RE.test(v);
}

/** `0721 234 567`, `+40 721 234 567`, `0040721234567` -> `+40721234567`. Null when not a Romanian mobile (+407…). */
export function normalizeRoPhone(raw: string): string | null {
  let d = raw.replace(/[\s().-]/g, '');
  if (d.startsWith('+')) d = d.slice(1);
  else if (d.startsWith('00')) d = d.slice(2);
  else if (d.startsWith('0')) d = `40${d.slice(1)}`;
  return /^407\d{8}$/.test(d) ? `+${d}` : null;
}

/** `sb 38 and` -> `SB38AND`. Loose on purpose (county letters, 2 or 3 digits, 3 letters): the server decides. */
export function normalizePlate(raw: string): string {
  return raw.replace(/[\s-]/g, '').toUpperCase();
}

export function isValidPlate(raw: string): boolean {
  return /^[A-Z]{1,2}\d{2,3}[A-Z]{3}$/.test(normalizePlate(raw));
}
