import { describe, expect, it } from 'vitest';
import {
  CURATED_PILOT_ROUTES,
  MIN_REAL_ROUTES,
  mergePopularRoutes,
  nameKey,
  type PlaceRef,
} from './popularRoutes.ts';

const p = (id: string, name: string): PlaceRef => ({ id, name });
const real = (a: PlaceRef, b: PlaceRef, rides = 3) => ({ from: a, to: b, rides });

const CIS = p('c', 'Cisnădie');
const PM = p('pm', 'Piața Mare');
const SEL = p('s', 'Șelimbăr');
const ZI = p('z', 'Zona Industrială Vest');
const HIP = p('h', 'Hipodrom');
const curated = [
  { from: CIS, to: PM },
  { from: SEL, to: ZI },
  { from: HIP, to: PM },
];

describe('CURATED_PILOT_ROUTES', () => {
  it('is the three Sibiu pilot corridors', () => {
    expect(CURATED_PILOT_ROUTES).toEqual([
      { from: 'Cisnădie', to: 'Centrul Istoric' },
      { from: 'Șelimbăr', to: 'Turnișor' },
      { from: 'Hipodrom I', to: 'Centrul Istoric' },
    ]);
    // that every name exists in the gazetteer is checked in curatedRoutes.test.ts
  });
});

describe('mergePopularRoutes', () => {
  it('uses only real routes when at least 3 qualify, keeping their order', () => {
    const r = [real(CIS, PM, 9), real(SEL, ZI, 5), real(HIP, PM, 2)];
    const out = mergePopularRoutes(r, curated, 5);
    expect(out.map((x) => x.source)).toEqual(['data', 'data', 'data']);
    expect(out.map((x) => x.rides)).toEqual([9, 5, 2]);
  });

  it('with no real routes returns the curated corridors, rides 0, source curated', () => {
    const out = mergePopularRoutes([], curated, 5);
    expect(out).toHaveLength(3);
    expect(out.every((x) => x.source === 'curated' && x.rides === 0)).toBe(true);
    expect(out.map((x) => x.from.name)).toEqual(['Cisnădie', 'Șelimbăr', 'Hipodrom']);
  });

  it('fills up to 3 in total after real routes, real ones first', () => {
    const out = mergePopularRoutes([real(p('a', 'Turnișor'), PM, 4)], curated, 5);
    expect(out.map((x) => x.source)).toEqual(['data', 'curated', 'curated']);
    expect(out).toHaveLength(MIN_REAL_ROUTES);
  });

  it('never duplicates a real route (same ids, or same names with other ids and diacritics)', () => {
    const sameIds = mergePopularRoutes([real(CIS, PM)], curated, 5);
    expect(sameIds.filter((x) => x.from.name === 'Cisnădie')).toHaveLength(1);
    expect(sameIds.map((x) => x.source)).toEqual(['data', 'curated', 'curated']);

    const sameNames = mergePopularRoutes(
      [real(p('x1', 'CISNADIE'), p('x2', 'piata mare'))],
      curated,
      5,
    );
    expect(sameNames.map((x) => x.source)).toEqual(['data', 'curated', 'curated']);
    expect(sameNames.some((x) => x.source === 'curated' && x.from.name === 'Cisnădie')).toBe(false);
  });

  it('skips unresolved or same-place corridors and may return fewer than 3', () => {
    const out = mergePopularRoutes(
      [],
      [
        { from: null, to: PM },
        { from: CIS, to: null },
        { from: PM, to: PM },
        { from: HIP, to: PM },
      ],
      5,
    );
    expect(out.map((x) => x.from.name)).toEqual(['Hipodrom']);
  });

  it('respects the limit', () => {
    expect(mergePopularRoutes([], curated, 2)).toHaveLength(2);
    expect(mergePopularRoutes([], curated, 1)).toHaveLength(1);
    const many = [real(CIS, PM), real(SEL, ZI), real(HIP, PM), real(PM, CIS)];
    expect(mergePopularRoutes(many, curated, 2)).toHaveLength(2);
  });
});

describe('nameKey', () => {
  it('ignores case and diacritics', () => {
    expect(nameKey(' Șelimbăr ')).toBe('selimbar');
    expect(nameKey('Piața Mare')).toBe(nameKey('PIATA MARE'));
  });
});
