/**
 * The 3 launch corridors (strategy.md section 2). Pure classification of a search or a ride by the
 * area names of its two ends, for the `search_performed` analytics event and the weekly
 * match-rate-per-corridor metric. Area names come from the gazetteer (`app.areas.name`); the
 * locality names are included because a search point in a suburb may be labelled with the town.
 * Matching is case-, diacritic- and punctuation-insensitive. The centre is shared by all three
 * corridors, so it does not count for any of them.
 */

export type Corridor = 'south' | 'west' | 'campus' | 'other';

export const LAUNCH_CORRIDORS = ['south', 'west', 'campus'] as const;

const normalise = (s: string): string =>
  s
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();

/** Area and locality names per corridor (raw spelling, normalised below). */
export const CORRIDOR_AREAS: Readonly<
  Record<(typeof LAUNCH_CORRIDORS)[number], readonly string[]>
> = {
  // Cisnădie, Șelimbăr and Calea Dumbrăvii towards the centre
  south: [
    'Cisnădie',
    'Șelimbăr',
    'Dumbrăvii',
    'Calea Dumbrăvii',
    'Doamna Stanca',
    'Tineretului',
    'Arhitecților',
    'Stejarul',
    'Piața Nouă',
    'Zona Cartier',
    'Colonia Seviș',
  ],
  // Vasile Aaron and Turnișor to Zona Industrială Vest and the airport area
  west: [
    'Vasile Aaron',
    'Turnișor',
    'Zona Industrială Vest',
    'Zona Industriala',
    'Aeroport',
    'Airport',
    'Nord - Vest',
  ],
  // Hipodrom, Ștrand and Mihai Viteazu to ULBS
  campus: [
    'Hipodrom',
    'Hipodrom I',
    'Hipodrom II',
    'Hipodrom III',
    'Hipodrom IV',
    'Ștrand',
    'Ștrand II',
    'Mihai Viteazu',
    'ULBS',
    'Terezian',
  ],
};

const NORMALISED: ReadonlyArray<readonly [Corridor, ReadonlySet<string>]> = LAUNCH_CORRIDORS.map(
  (c) => [c, new Set(CORRIDOR_AREAS[c].map(normalise))] as const,
);

/** How many of the given area names belong to a corridor (0 to 2 for a search). */
function score(set: ReadonlySet<string>, areas: readonly (string | null | undefined)[]): number {
  let n = 0;
  for (const a of areas) if (a && set.has(normalise(a))) n += 1;
  return n;
}

/**
 * The corridor of a trip from `fromArea` to `toArea`: the corridor that contains the most of the
 * two names (ties go to the first of south, west, campus); `other` when neither name is in one.
 */
export function classifyCorridor(
  fromArea: string | null | undefined,
  toArea: string | null | undefined,
): Corridor {
  let best: Corridor = 'other';
  let bestScore = 0;
  for (const [corridor, set] of NORMALISED) {
    const s = score(set, [fromArea, toArea]);
    if (s > bestScore) {
      best = corridor;
      bestScore = s;
    }
  }
  return best;
}
