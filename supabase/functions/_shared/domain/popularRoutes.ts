import { inCoverage } from './privacy.ts';

/**
 * Popular routes, pure part (no I/O): merging real ranked routes with the curated pilot corridors.
 * The ranking itself (window, min 2 drivers, score, order) is SQL: app.popular_routes().
 */

/**
 * CURATED_PILOT_ROUTES: the three Sibiu pilot corridors the web app used to hard-code (FindScreen).
 * Used ONLY as a fallback while fewer than MIN_REAL_ROUTES real routes qualify, always answered with
 * `source: 'curated'` and `rides: 0`. Names are resolved to gazetteer places server-side; a corridor
 * that cannot be resolved is skipped.
 */
export type CuratedEnd = {
  /** Gazetteer name to look up (exact, diacritics and case insensitive). */
  name: string;
  /** Narrows the lookup to this locality, for names that exist in several ("Centru"). */
  locality?: string;
  /** Name shown to the user instead of `name` (the place keeps its id and point). */
  label?: string;
};

export const CURATED_PILOT_ROUTES: readonly { from: CuratedEnd; to: CuratedEnd }[] = [
  // Every end must be an EXISTING gazetteer place of kind `area` INSIDE COVERAGE: guarded by a test
  // against supabase/seed/gazetteer/places.csv. (The first version used "Piața Mare", which exists only
  // as street addresses, and "Zona Industrială Vest", which does not exist at all; the second used the
  // locality row "Cisnădie", whose point is outside coverage, so POST /search answered 400.)
  // Route 1 starts from the centre of Cisnădie, shown as "Cisnădie".
  {
    from: { name: 'Centru', locality: 'Cisnădie', label: 'Cisnădie' },
    to: { name: 'Centrul Istoric' },
  },
  { from: { name: 'Șelimbăr' }, to: { name: 'Turnișor' } },
  { from: { name: 'Hipodrom I' }, to: { name: 'Centrul Istoric' } },
];

/** Fewer real routes than this: fill up with curated ones (up to this many in total). */
export const MIN_REAL_ROUTES = 3;

export type PlaceRef = { id: string; name: string; point: { lat: number; lng: number } };

/**
 * Shows a resolved place under a curated label. Id and point stay (the app searches with them); the
 * secondary line keeps the original name so the user still sees where the point is ("Centru").
 */
export function withLabel<P extends PlaceRef & { secondary: string }>(
  place: P,
  label: string | undefined,
): P {
  if (!label || label === place.name) return place;
  const secondary = [place.name, ...place.secondary.split(', ')]
    .filter((v) => v && nameKey(v) !== nameKey(label))
    .filter((v, i, all) => all.indexOf(v) === i)
    .join(', ');
  return { ...place, name: label, secondary };
}

export type MergedRoute<P extends PlaceRef> = {
  from: P;
  to: P;
  rides: number;
  source: 'data' | 'curated';
};

/** Diacritics-insensitive, case-insensitive name key. */
export function nameKey(name: string): string {
  return name.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().trim();
}

const routeKeys = (from: PlaceRef, to: PlaceRef): string[] => [
  `id:${from.id}>${to.id}`,
  `name:${nameKey(from.name)}>${nameKey(to.name)}`,
];

/**
 * Real routes first (already ranked, `source: 'data'`). When fewer than MIN_REAL_ROUTES are real,
 * resolved curated corridors are appended in their fixed order until the list has
 * min(limit, MIN_REAL_ROUTES) items. A curated corridor is skipped when either end is unresolved,
 * both ends are the same place, or it duplicates a real route (same ids or same names).
 * Any route (real or curated) with an end outside coverage is dropped, because the app could not
 * search it. Real routes are filtered before counting, so the curated fill-up still reaches the target.
 * The result is never longer than `limit`.
 */
export function mergePopularRoutes<P extends PlaceRef>(
  real: readonly { from: P; to: P; rides: number }[],
  curated: readonly { from: P | null; to: P | null }[],
  limit: number,
): MergedRoute<P>[] {
  const usable = real.filter((r) => inCoverage(r.from.point) && inCoverage(r.to.point));
  const out: MergedRoute<P>[] = usable
    .slice(0, limit)
    .map((r) => ({ from: r.from, to: r.to, rides: r.rides, source: 'data' as const }));
  if (usable.length >= MIN_REAL_ROUTES) return out;

  const target = Math.min(limit, MIN_REAL_ROUTES);
  const seen = new Set(out.flatMap((r) => routeKeys(r.from, r.to)));
  for (const c of curated) {
    if (out.length >= target) break;
    if (!c.from || !c.to) continue;
    if (!inCoverage(c.from.point) || !inCoverage(c.to.point)) continue;
    if (c.from.id === c.to.id || nameKey(c.from.name) === nameKey(c.to.name)) continue;
    const keys = routeKeys(c.from, c.to);
    if (keys.some((k) => seen.has(k))) continue;
    keys.forEach((k) => seen.add(k));
    out.push({ from: c.from, to: c.to, rides: 0, source: 'curated' });
  }
  return out;
}
