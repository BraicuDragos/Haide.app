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
export const CURATED_PILOT_ROUTES: readonly { from: string; to: string }[] = [
  { from: 'Cisnădie', to: 'Piața Mare' },
  { from: 'Șelimbăr', to: 'Zona Industrială Vest' },
  { from: 'Hipodrom', to: 'Piața Mare' },
];

/** Fewer real routes than this: fill up with curated ones (up to this many in total). */
export const MIN_REAL_ROUTES = 3;

export type PlaceRef = { id: string; name: string };

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
 * The result is never longer than `limit`.
 */
export function mergePopularRoutes<P extends PlaceRef>(
  real: readonly { from: P; to: P; rides: number }[],
  curated: readonly { from: P | null; to: P | null }[],
  limit: number,
): MergedRoute<P>[] {
  const out: MergedRoute<P>[] = real
    .slice(0, limit)
    .map((r) => ({ from: r.from, to: r.to, rides: r.rides, source: 'data' as const }));
  if (real.length >= MIN_REAL_ROUTES) return out;

  const target = Math.min(limit, MIN_REAL_ROUTES);
  const seen = new Set(out.flatMap((r) => routeKeys(r.from, r.to)));
  for (const c of curated) {
    if (out.length >= target) break;
    if (!c.from || !c.to) continue;
    if (c.from.id === c.to.id || nameKey(c.from.name) === nameKey(c.to.name)) continue;
    const keys = routeKeys(c.from, c.to);
    if (keys.some((k) => seen.has(k))) continue;
    keys.forEach((k) => seen.add(k));
    out.push({ from: c.from, to: c.to, rides: 0, source: 'curated' });
  }
  return out;
}
