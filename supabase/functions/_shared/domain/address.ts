/**
 * Address queries with a house number (ADR 0042). Pure: no I/O, never throws, deterministic.
 *
 * The gazetteer (app.places) holds only the numbers OpenStreetMap knows, so "Negoveanu 2" can be
 * missing while "Negoveanu 4" exists. These functions parse what the user typed, build the label
 * that is shown and stored (the number is kept exactly as typed) and estimate where a missing number
 * is, from the known numbers of the same street. Diacritics are folded for matching only.
 */

export type LatLngLike = { lat: number; lng: number };

export type AddressNumber = {
  n: number;
  /** `''`, a letter (`'A'`), a slash part (`'/B'`, `'/1'`, `'A/2'`) or `' bis'`. */
  suffix: string;
};

export type AddressExtras = { bloc?: string; scara?: string; ap?: string };

export type ParsedAddress = {
  /** Unaccented lower-case street words without street-type words and number markers. */
  streetWords: string[];
  /** `streetWords` joined by one space. Empty when no street was typed. */
  streetKey: string;
  /** Null when there is no number or the street key is shorter than 2 characters. */
  number: AddressNumber | null;
  extras: AddressExtras;
  /** The number exactly as typed (`'2 A'`, `'2/B'`, `'2-4'`), `''` when there is none. */
  rawNumberText: string;
};

export type EstimateMethod = 'interpolated' | 'nearest' | 'street';
export type Estimate = { lat: number; lng: number; method: EstimateMethod };
export type KnownNumber = { n: number; suffix: string; lat: number; lng: number };

/** Interpolation is used only when the two bracketing known numbers are at most this far apart. */
export const INTERPOLATION_MAX_GAP_M = 300;
export const ADDRESS_LABEL_MAX = 80;

/** Street-type words and number markers that never belong to the street key (folded, lower case). */
const IGNORED_WORDS = new Set([
  'str',
  'strada',
  'bd',
  'bdul',
  'bulevard',
  'bulevardul',
  'blvd',
  'calea',
  'cal',
  'aleea',
  'al',
  'piata',
  'pta',
  'intrarea',
  'intr',
  'soseaua',
  'sos',
  'splaiul',
  'drumul',
  'nr',
  'no',
  'numarul',
  'numar',
]);

/** Strips diacritics (cedilla and comma-below forms alike). Case is kept. */
export function foldDiacritics(s: string): string {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '');
}

/** Unaccented, lower case, single spaces: the form used for every comparison. */
export function normalizeForMatch(s: string): string {
  return foldDiacritics(s).toLowerCase().replace(/\s+/g, ' ').trim();
}

const EXTRA_RES: { key: keyof AddressExtras; re: RegExp }[] = [
  { key: 'scara', re: /(^|[^a-z0-9])(?:scara|sc)(?![a-z])\.?\s*([a-z0-9]+)/i },
  { key: 'ap', re: /(^|[^a-z0-9])(?:apartament|ap)(?![a-z])\.?\s*([a-z0-9]+)/i },
  { key: 'bloc', re: /(^|[^a-z0-9])(?:bloc|bl)(?![a-z])\.?\s*([a-z0-9]+)/i },
];

/** Private-use characters that protect a "/" or "-" inside a number while other punctuation is blanked. */
const SLASH_MARK = String.fromCharCode(0xe001);
const DASH_MARK = String.fromCharCode(0xe002);

const NUMBER_TOKEN = /^(\d{1,4})([a-z])?(?:([/-])([a-z0-9]+))?$/i;

type Tok = { raw: string; low: string };

type Num = { n: number; suffix: string };

function tokenNumber(t: Tok): Num | null {
  const m = NUMBER_TOKEN.exec(t.raw);
  if (!m) return null;
  const n = Number(m[1]);
  if (!Number.isInteger(n) || n < 1) return null;
  let suffix = (m[2] ?? '').toUpperCase();
  // "2/B" and "5/1" keep the slash part, "2-4" is a range: it counts as 2.
  if (m[3] === '/' && m[4]) suffix += `/${m[4].toUpperCase()}`;
  return { n, suffix };
}

const isSuffixWord = (t: Tok | undefined): boolean =>
  t !== undefined && (/^[a-z]$/i.test(t.raw) || t.low === 'bis');

function suffixFrom(t: Tok): string {
  return t.low === 'bis' ? ' bis' : t.raw.toUpperCase();
}

const EMPTY: ParsedAddress = {
  streetWords: [],
  streetKey: '',
  number: null,
  extras: {},
  rawNumberText: '',
};

/**
 * Reads a free-text address query. Accepts both word orders ("negoveanu 2", "2 negoveanu"), street
 * prefixes ("str.", "bd.", "calea"), "nr." markers and `bl.`/`sc.`/`ap.` parts. Extras are kept for the
 * display label and never move the point. Numbers: `2`, `2A`, `2 A`, `2/B`, `2-4` (counts as 2),
 * `12 bis`. A very short street key (under 2 characters) or no number gives `number: null`.
 */
export function parseAddressQuery(q: string): ParsedAddress {
  try {
    return parse(q);
  } catch {
    return { ...EMPTY, extras: {} };
  }
}

function parse(q: unknown): ParsedAddress {
  if (typeof q !== 'string') return { ...EMPTY, extras: {} };
  let text = foldDiacritics(q).slice(0, 200);

  // 1. bl. / sc. / ap. parts: remembered for the label, removed from the street text.
  const extras: AddressExtras = {};
  for (const { key, re } of EXTRA_RES) {
    const m = re.exec(text);
    if (m?.[2]) {
      extras[key] = m[2].toUpperCase();
      text = `${text.slice(0, m.index)}${m[1] ?? ''} ${text.slice(m.index + m[0].length)}`;
    }
  }

  // 2. Punctuation to spaces, except a "-" or "/" inside a number ("2-4", "2/B", "3A-3B").
  text = text
    .replace(/[#.,;:()]/g, ' ')
    .replace(/(?<=(?:^|[^a-z0-9])[0-9]{1,4}[a-z]?)\/(?=[0-9a-z])/gi, SLASH_MARK)
    .replace(/(?<=(?:^|[^a-z0-9])[0-9]{1,4}[a-z]?)-(?=[0-9a-z])/gi, DASH_MARK)
    .replace(/[-/–—]/g, ' ')
    .replaceAll(SLASH_MARK, '/')
    .replaceAll(DASH_MARK, '-');

  const tokens: Tok[] = text
    .split(/\s+/)
    .filter(Boolean)
    .map((raw) => ({ raw, low: raw.toLowerCase() }))
    .filter((t) => !IGNORED_WORDS.has(t.low));

  // 3. Where is the number? Last token (street first) or first token (number first).
  let numTok: Num | null = null;
  let rawNumber = '';
  let rest: Tok[] = tokens;

  const last = tokens.length - 1;
  const lastTok = tokens[last];
  const prevTok = tokens[last - 1];
  if (lastTok && isSuffixWord(lastTok) && prevTok && tokenNumber(prevTok) && last - 1 > 0) {
    // "negoveanu 2 a", "calea poplacii 11 bis"
    numTok = tokenNumber(prevTok);
    if (numTok) {
      numTok.suffix = numTok.suffix || suffixFrom(lastTok);
      rawNumber = `${prevTok.raw} ${lastTok.raw}`;
      rest = tokens.slice(0, last - 1);
    }
  } else if (lastTok && last > 0 && tokenNumber(lastTok)) {
    numTok = tokenNumber(lastTok);
    rawNumber = lastTok.raw;
    rest = tokens.slice(0, last);
  } else if (tokens.length > 1 && tokens[0] && tokenNumber(tokens[0])) {
    // "2 negoveanu", "2 a negoveanu", "12 bis calea poplacii"
    const first = tokens[0];
    numTok = tokenNumber(first);
    rawNumber = first.raw;
    rest = tokens.slice(1);
    const second = tokens[1];
    if (numTok && second && isSuffixWord(second) && tokens.length > 2) {
      numTok.suffix = numTok.suffix || suffixFrom(second);
      rawNumber = `${first.raw} ${second.raw}`;
      rest = tokens.slice(2);
    }
  }

  const streetWords = (numTok ? rest : tokens).map((t) => t.low);
  // Digits-only input has no street.
  if (streetWords.length === 0 || streetWords.every((w) => /^[0-9/-]+$/.test(w))) {
    return { streetWords: [], streetKey: '', number: null, extras, rawNumberText: '' };
  }
  const streetKey = streetWords.join(' ');
  if (!numTok || streetKey.length < 2) {
    return { streetWords, streetKey, number: null, extras, rawNumberText: '' };
  }
  return {
    streetWords,
    streetKey,
    number: { n: numTok.n, suffix: numTok.suffix },
    extras,
    rawNumberText: rawNumber,
  };
}

/** The part of a number after its digits, as the label shows it: `2`, `2A`, `2/B`, `12 bis`. */
export function formatNumber(num: AddressNumber): string {
  return `${num.n}${num.suffix}`;
}

/**
 * `Strada Negoveanu 2` or `Strada Negoveanu 2A, bl. B5, sc. 2`. The street keeps the spelling of the
 * data, the number is what the user typed (only the letter case of a suffix is normalised). At most 80
 * characters: the extras are dropped first, then the street is shortened so the number always fits.
 */
export function buildAddressLabel(
  canonicalStreetName: string,
  num: AddressNumber,
  extras: AddressExtras = {},
  max: number = ADDRESS_LABEL_MAX,
): string {
  const street = canonicalStreetName.replace(/\s+/g, ' ').trim();
  const numberText = formatNumber(num);
  const parts: string[] = [];
  if (extras.bloc) parts.push(`bl. ${extras.bloc}`);
  if (extras.scara) parts.push(`sc. ${extras.scara}`);
  if (extras.ap) parts.push(`ap. ${extras.ap}`);
  // Drop extras from the end until everything fits.
  for (let keep = parts.length; keep >= 0; keep--) {
    const tail = parts.slice(0, keep).join(', ');
    const label = `${street} ${numberText}${tail ? `, ${tail}` : ''}`;
    if (label.length <= max) return label;
  }
  const room = Math.max(0, max - numberText.length - 1);
  return `${street.slice(0, room).trimEnd()} ${numberText}`.trim().slice(0, max);
}

// ---- positions ------------------------------------------------------------------------------------

const EARTH_R_M = 6_371_008.8;
const rad = (d: number) => (d * Math.PI) / 180;

/** Great-circle distance in metres. */
export function haversineM(a: LatLngLike, b: LatLngLike): number {
  const dLat = rad(b.lat - a.lat);
  const dLng = rad(b.lng - a.lng);
  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_R_M * Math.asin(Math.min(1, Math.sqrt(h)));
}

const round6 = (v: number): number => Math.round(v * 1e6) / 1e6 + 0;

/** One point per number (a number with several suffixes keeps the first by suffix, then position). */
function collapseByNumber(known: KnownNumber[]): KnownNumber[] {
  const byN = new Map<number, KnownNumber>();
  for (const k of known) {
    if (!Number.isFinite(k.n) || !Number.isFinite(k.lat) || !Number.isFinite(k.lng)) continue;
    const cur = byN.get(k.n);
    if (
      !cur ||
      k.suffix < cur.suffix ||
      (k.suffix === cur.suffix && (k.lat < cur.lat || (k.lat === cur.lat && k.lng < cur.lng)))
    ) {
      byN.set(k.n, k);
    }
  }
  return [...byN.values()].sort((a, b) => a.n - b.n);
}

/**
 * Where is house number `target`? Best available first:
 * 0. the same number is known (another suffix): that point;
 * a. the nearest lower and higher known numbers of the same parity (same side of the street), when
 *    they are at most 300 m apart: linear interpolation by number;
 * b. the nearest known number (same parity preferred, never extrapolated): its point;
 * c. the street's own point;
 * d. null (nothing known, nothing is invented).
 * Equal distances resolve to the lower number. Coordinates have 6 decimals.
 */
export function estimatePosition(
  known: KnownNumber[],
  target: number,
  streetPoint?: LatLngLike | null,
): Estimate | null {
  const pts = collapseByNumber(known);
  const street =
    streetPoint && Number.isFinite(streetPoint.lat) && Number.isFinite(streetPoint.lng)
      ? streetPoint
      : null;
  if (!Number.isFinite(target) || target < 1) {
    return street ? { lat: round6(street.lat), lng: round6(street.lng), method: 'street' } : null;
  }

  const same = pts.find((p) => p.n === target);
  if (same) return { lat: round6(same.lat), lng: round6(same.lng), method: 'nearest' };

  const parity = target % 2;
  const sameSide = pts.filter((p) => p.n % 2 === parity);
  const lower = [...sameSide].reverse().find((p) => p.n < target);
  const higher = sameSide.find((p) => p.n > target);
  if (lower && higher && haversineM(lower, higher) <= INTERPOLATION_MAX_GAP_M) {
    const t = (target - lower.n) / (higher.n - lower.n);
    return {
      lat: round6(lower.lat + (higher.lat - lower.lat) * t),
      lng: round6(lower.lng + (higher.lng - lower.lng) * t),
      method: 'interpolated',
    };
  }

  if (pts.length > 0) {
    // Same parity wins a tie: the other side of the street costs one number of distance.
    const cost = (p: KnownNumber) => Math.abs(p.n - target) + (p.n % 2 === parity ? 0 : 1);
    const best = [...pts].sort(
      (a, b) =>
        cost(a) - cost(b) || Number(b.n % 2 === parity) - Number(a.n % 2 === parity) || a.n - b.n,
    )[0];
    if (best) return { lat: round6(best.lat), lng: round6(best.lng), method: 'nearest' };
  }

  return street ? { lat: round6(street.lat), lng: round6(street.lng), method: 'street' } : null;
}

// ---- known addresses of the gazetteer -------------------------------------------------------------------

/**
 * Splits a gazetteer address name such as `Strada Negoveanu 4`, `Strada X 12A`, `Strada X 3/B`,
 * `Strada Gladiolelor 4-8`, `Calea Poplăcii 11 Bis` into the street and its (first) number. Names that
 * do not end in a number (`Calea Dumbrăvii Bl. 16 Sc. A`, `Strada X Bl. 5`) give null.
 */
export function parseKnownAddressName(
  name: string,
): { street: string; n: number; suffix: string } | null {
  const clean = name.replace(/\s+/g, ' ').trim();
  const m = /^(.+?) (\d{1,4})([A-Za-z])?(?:(?:-[0-9A-Za-z]+)|\/([0-9A-Za-z]+)| (bis))?$/i.exec(
    clean,
  );
  if (!m) return null;
  const street = (m[1] ?? '').trim();
  const n = Number(m[2]);
  if (!street || !Number.isInteger(n) || n < 1) return null;
  // "Strada X Bl. 5" and "... Sc. 2" are blocks and stairs, not house numbers.
  if (/(^|\s)(bl|bloc|sc|scara|ap|apartament)\.?$/i.test(street)) return null;
  let suffix = (m[3] ?? '').toUpperCase();
  if (m[4]) suffix += `/${m[4].toUpperCase()}`;
  if (m[5]) suffix += ' bis';
  return { street, n, suffix };
}

export type PlaceRowLike = {
  name: string;
  kind: string;
  locality: string | null;
  lat: number;
  lng: number;
};

export type StreetCandidate = {
  locality: string;
  /** Canonical spelling from the data, e.g. `Strada Negoveanu`. */
  name: string;
  streetPoint: LatLngLike | null;
  known: KnownNumber[];
};

/** Street words of a canonical street name (type words removed), for matching against the key. */
function streetWordsOf(streetName: string): string[] {
  return normalizeForMatch(streetName.replace(/[.,;:()#]/g, ' '))
    .split(' ')
    .filter((w) => w && !IGNORED_WORDS.has(w));
}

/** 2 = same words, 1 = the key is a contiguous run of words (last may be a prefix), 0 = no. */
export function streetMatchScore(streetWords: string[], keyWords: string[]): 0 | 1 | 2 {
  if (keyWords.length === 0 || streetWords.length < keyWords.length) return 0;
  for (let i = 0; i + keyWords.length <= streetWords.length; i++) {
    let ok = true;
    for (let j = 0; j < keyWords.length; j++) {
      const s = streetWords[i + j] ?? '';
      const k = keyWords[j] ?? '';
      const last = j === keyWords.length - 1;
      if (!(last ? s.startsWith(k) : s === k)) {
        ok = false;
        break;
      }
    }
    if (ok) {
      return streetWords.length === keyWords.length &&
        streetWords.every((w, i) => w === keyWords[i])
        ? 2
        : 1;
    }
  }
  return 0;
}

/**
 * Groups gazetteer rows (kind street or address) by locality and street name and keeps, for each of
 * at most `maxLocalities` localities, the best street for the typed key: exact words first, then
 * fewer extra words, then more evidence. Rows whose street does not match the key are ignored.
 */
export function groupStreetCandidates(
  rows: PlaceRowLike[],
  streetKey: string,
  maxLocalities = 2,
): StreetCandidate[] {
  const keyWords = normalizeForMatch(streetKey).split(' ').filter(Boolean);
  type Acc = StreetCandidate & { words: string[]; score: 1 | 2 };
  const groups = new Map<string, Acc>();

  for (const r of rows) {
    if (r.kind !== 'street' && r.kind !== 'address') continue;
    let street = r.name.replace(/\s+/g, ' ').trim();
    let num: { n: number; suffix: string } | null = null;
    if (r.kind === 'address') {
      const p = parseKnownAddressName(r.name);
      if (!p) continue;
      street = p.street;
      num = { n: p.n, suffix: p.suffix };
    }
    const words = streetWordsOf(street);
    const score = streetMatchScore(words, keyWords);
    if (score === 0) continue;
    const locality = (r.locality ?? '').trim();
    const gk = `${normalizeForMatch(locality)}|${normalizeForMatch(street)}`;
    let g = groups.get(gk);
    if (!g) {
      g = { locality, name: street, streetPoint: null, known: [], words, score };
      groups.set(gk, g);
    }
    if (num) g.known.push({ ...num, lat: r.lat, lng: r.lng });
    else g.streetPoint ??= { lat: r.lat, lng: r.lng };
  }

  const evidence = (g: Acc) => g.known.length + (g.streetPoint ? 1 : 0);
  const sorted = [...groups.values()].sort(
    (a, b) =>
      b.score - a.score ||
      a.words.length - b.words.length ||
      evidence(b) - evidence(a) ||
      a.name.localeCompare(b.name),
  );
  const perLocality = new Map<string, Acc>();
  for (const g of sorted) {
    const k = normalizeForMatch(g.locality);
    if (!perLocality.has(k)) perLocality.set(k, g);
  }
  return [...perLocality.values()]
    .sort(
      (a, b) =>
        b.score - a.score || evidence(b) - evidence(a) || a.locality.localeCompare(b.locality),
    )
    .slice(0, maxLocalities)
    .map(({ locality, name, streetPoint, known }) => ({ locality, name, streetPoint, known }));
}

/** True when the street already holds exactly this number and suffix (letter case ignored). */
export function hasExactNumber(known: KnownNumber[], num: AddressNumber): boolean {
  const s = num.suffix.toUpperCase();
  return known.some((k) => k.n === num.n && k.suffix.toUpperCase() === s);
}

/** Stable, URL-safe id of a synthetic place: never collides with a uuid. */
export function approximatePlaceId(
  locality: string,
  streetName: string,
  num: AddressNumber,
): string {
  const raw = `${normalizeForMatch(locality)}|${normalizeForMatch(streetName)}|${normalizeForMatch(formatNumber(num))}`;
  const bytes = new TextEncoder().encode(raw);
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return `approx:${btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')}`;
}
