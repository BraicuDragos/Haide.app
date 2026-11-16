/**
 * Stored routes for the fixture provider (local development and CI: no network).
 * Trips A, B and C are the worked examples of pricing.md §5. Distances and durations are the
 * published OSRM values; the polylines are hand-placed approximations of the real roads
 * (vertices are [lng, lat]) so that map rendering and matching tests have realistic shapes.
 */
export type FixtureRoute = {
  id: 'trip-a' | 'trip-b' | 'trip-c';
  distanceM: number;
  durationS: number;
  coordinates: [number, number][];
};

export const FIXTURE_ROUTES: readonly FixtureRoute[] = [
  {
    // Cisnădie (Str. Măgurii) to Piața Mare, via Șelimbăr (Shopping City). Petrol example.
    id: 'trip-a',
    distanceM: 11_514,
    durationS: 1_020,
    coordinates: [
      [24.151, 45.709],
      [24.1585, 45.7152],
      [24.1698, 45.7261],
      [24.1792, 45.7352],
      [24.1861, 45.7413],
      [24.1868, 45.7489],
      [24.1822, 45.7566],
      [24.1741, 45.7651],
      [24.1668, 45.7738],
      [24.1596, 45.7826],
      [24.1548, 45.7909],
      [24.1505, 45.7977],
    ],
  },
  {
    // Șelimbăr (Shopping City) to Zona Industrială Vest (Str. Salzburg). Diesel example.
    id: 'trip-b',
    distanceM: 9_588,
    durationS: 1_020,
    coordinates: [
      [24.1861, 45.7413],
      [24.1765, 45.7447],
      [24.1642, 45.7483],
      [24.1498, 45.7531],
      [24.1371, 45.7592],
      [24.1239, 45.7661],
      [24.1128, 45.7728],
      [24.1032, 45.7786],
      [24.0961, 45.7826],
      [24.09, 45.785],
    ],
  },
  {
    // Hipodrom to the old town (Str. Cetății). Petrol example.
    id: 'trip-c',
    distanceM: 4_234,
    durationS: 420,
    coordinates: [
      [24.133, 45.772],
      [24.1368, 45.7771],
      [24.1401, 45.7822],
      [24.1432, 45.7871],
      [24.1458, 45.7918],
      [24.149, 45.7955],
    ],
  },
];
