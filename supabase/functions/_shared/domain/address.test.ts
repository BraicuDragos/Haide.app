import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  approximatePlaceId,
  buildAddressLabel,
  estimatePosition,
  groupStreetCandidates,
  hasExactNumber,
  haversineM,
  normalizeForMatch,
  parseAddressQuery,
  parseKnownAddressName,
  streetMatchScore,
  type KnownNumber,
} from './address.ts';

describe('parseAddressQuery', () => {
  const cases: [string, string, { n: number; suffix: string } | null, string][] = [
    ['Negoveanu 2', 'negoveanu', { n: 2, suffix: '' }, '2'],
    ['negoveanu 2', 'negoveanu', { n: 2, suffix: '' }, '2'],
    ['str. negoveanu nr. 2', 'negoveanu', { n: 2, suffix: '' }, '2'],
    ['Strada Negoveanu nr 2', 'negoveanu', { n: 2, suffix: '' }, '2'],
    ['Strada Negoveanu 2A', 'negoveanu', { n: 2, suffix: 'A' }, '2A'],
    ['Strada Negoveanu 2a', 'negoveanu', { n: 2, suffix: 'A' }, '2a'],
    ['Strada Negoveanu 2 A', 'negoveanu', { n: 2, suffix: 'A' }, '2 A'],
    ['Strada Negoveanu 2/B', 'negoveanu', { n: 2, suffix: '/B' }, '2/B'],
    ['Strada Negoveanu 2-4', 'negoveanu', { n: 2, suffix: '' }, '2-4'],
    ['Strada Negoveanu 3A-3B', 'negoveanu', { n: 3, suffix: 'A' }, '3A-3B'],
    ['Calea Poplăcii 12 bis', 'poplacii', { n: 12, suffix: ' bis' }, '12 bis'],
    ['Bd. Victoriei 12', 'victoriei', { n: 12, suffix: '' }, '12'],
    ['Bulevardul Victoriei, nr. 12', 'victoriei', { n: 12, suffix: '' }, '12'],
    ['2 Negoveanu', 'negoveanu', { n: 2, suffix: '' }, '2'],
    ['2A Negoveanu', 'negoveanu', { n: 2, suffix: 'A' }, '2A'],
    ['2 A Negoveanu', 'negoveanu', { n: 2, suffix: 'A' }, '2 A'],
    ['#2 negoveanu', 'negoveanu', { n: 2, suffix: '' }, '2'],
    ['ȘTEFAN CEL MARE 3', 'stefan cel mare', { n: 3, suffix: '' }, '3'],
    ['STEFAN CEL MARE 3', 'stefan cel mare', { n: 3, suffix: '' }, '3'],
    ['Ștefan cel Mare 3', 'stefan cel mare', { n: 3, suffix: '' }, '3'],
    ['Şt. cel Mare 3', 'st cel mare', { n: 3, suffix: '' }, '3'],
    ['Șelimbăr 5', 'selimbar', { n: 5, suffix: '' }, '5'],
    ['Şelimbăr 5', 'selimbar', { n: 5, suffix: '' }, '5'],
    ['Țiglari 7', 'tiglari', { n: 7, suffix: '' }, '7'],
    ['Ţiglari 7', 'tiglari', { n: 7, suffix: '' }, '7'],
    ['Aleea Streiu 8A', 'streiu', { n: 8, suffix: 'A' }, '8A'],
    ['  Negoveanu    2  ', 'negoveanu', { n: 2, suffix: '' }, '2'],
    ['Strada 9 Mai 3', '9 mai', { n: 3, suffix: '' }, '3'],
    ['Piața Unirii 4', 'unirii', { n: 4, suffix: '' }, '4'],
    ['Splaiul Independenței 12', 'independentei', { n: 12, suffix: '' }, '12'],
    ['Negoveanu', 'negoveanu', null, ''],
    ['Strada Negoveanu', 'negoveanu', null, ''],
    ['Negoveanu 0', 'negoveanu 0', null, ''],
  ];
  it.each(cases)('%s', (q, key, number, raw) => {
    const p = parseAddressQuery(q);
    expect(p.streetKey).toBe(key);
    expect(p.streetWords).toEqual(key.split(' '));
    expect(p.number).toEqual(number);
    expect(p.rawNumberText).toBe(raw);
  });

  it('keeps bl./sc./ap. for the label and never treats them as the number', () => {
    const p = parseAddressQuery('Calea Dumbrăvii 17 bl. B5 sc. 2 ap. 14');
    expect(p.streetKey).toBe('dumbravii');
    expect(p.number).toEqual({ n: 17, suffix: '' });
    expect(p.extras).toEqual({ bloc: 'B5', scara: '2', ap: '14' });
    const q = parseAddressQuery('Negoveanu bloc 3 scara A 5');
    expect(q.number).toEqual({ n: 5, suffix: '' });
    expect(q.extras).toEqual({ bloc: '3', scara: 'A' });
    expect(parseAddressQuery('Negoveanu 2 apartament 9').extras).toEqual({ ap: '9' });
  });

  it('answers "bl 5 sc 2" alone with extras but no street and no number', () => {
    const p = parseAddressQuery('bl 5 sc 2');
    expect(p.streetKey).toBe('');
    expect(p.number).toBeNull();
    expect(p.extras).toEqual({ bloc: '5', scara: '2' });
  });

  it('does not mistake street names that start like bl/sc/ap for extras', () => {
    expect(parseAddressQuery('Strada Blajului 4').extras).toEqual({});
    expect(parseAddressQuery('Strada Scoalei 4').streetKey).toBe('scoalei');
    expect(parseAddressQuery('Strada Aprodului 4').streetKey).toBe('aprodului');
  });

  it('handles very short and digit-only input', () => {
    for (const q of ['', ' ', '2', '12', '2 4', 'a', 'a 2', 'x 5', '#', 'nr. 2', 'str.']) {
      const p = parseAddressQuery(q);
      expect(p.number, q).toBeNull();
    }
    expect(parseAddressQuery('2').streetKey).toBe('');
    expect(parseAddressQuery('ab 2').number).toEqual({ n: 2, suffix: '' });
  });

  it('does not throw on odd input', () => {
    for (const q of [
      '\u0000',
      '😀 5',
      '---',
      '/',
      '2/',
      '/2',
      '1e9',
      '99999',
      'x'.repeat(5000) + ' 4',
    ]) {
      expect(() => parseAddressQuery(q)).not.toThrow();
    }
    expect(parseAddressQuery(undefined as unknown as string).number).toBeNull();
    expect(parseAddressQuery(null as unknown as string).streetKey).toBe('');
  });

  it('property: never throws and always returns a consistent shape', () => {
    fc.assert(
      fc.property(fc.string({ maxLength: 120 }), (q) => {
        const p = parseAddressQuery(q);
        expect(p.streetKey).toBe(p.streetWords.join(' '));
        if (p.number) {
          expect(p.number.n).toBeGreaterThanOrEqual(1);
          expect(Number.isInteger(p.number.n)).toBe(true);
          expect(p.streetKey.length).toBeGreaterThanOrEqual(2);
          expect(p.rawNumberText).not.toBe('');
        } else {
          expect(p.rawNumberText).toBe('');
        }
      }),
      { numRuns: 300 },
    );
  });

  it('property: "<street> <n>" and "<n> <street>" give the same street and number', () => {
    const word = fc
      .stringMatching(/^[a-z]{3,10}$/)
      .filter((w) => !['nr', 'str', 'bis', 'sos'].includes(w));
    fc.assert(
      fc.property(word, fc.integer({ min: 1, max: 999 }), (w, n) => {
        const a = parseAddressQuery(`${w} ${n}`);
        const b = parseAddressQuery(`${n} ${w}`);
        expect(a.streetKey).toBe(w);
        expect(b.streetKey).toBe(w);
        expect(a.number).toEqual({ n, suffix: '' });
        expect(b.number).toEqual({ n, suffix: '' });
      }),
      { numRuns: 200 },
    );
  });

  it('property: diacritics do not change the street key', () => {
    fc.assert(
      fc.property(fc.integer({ min: 1, max: 500 }), (n) => {
        const a = parseAddressQuery(`Șelimbăr Țării Înțelepților ${n}`);
        const b = parseAddressQuery(`Selimbar Tarii Intelepților ${n}`);
        expect(a.streetKey).toBe(
          'selimbar tarii intelepților'.normalize('NFD').replace(/[̀-ͯ]/g, ''),
        );
        expect(a.streetKey).toBe(b.streetKey);
      }),
      { numRuns: 30 },
    );
  });
});

describe('buildAddressLabel', () => {
  it('keeps the number exactly as typed', () => {
    expect(buildAddressLabel('Strada Negoveanu', { n: 2, suffix: '' })).toBe('Strada Negoveanu 2');
    expect(buildAddressLabel('Strada Negoveanu', { n: 2, suffix: 'A' })).toBe(
      'Strada Negoveanu 2A',
    );
    expect(buildAddressLabel('Strada Negoveanu', { n: 2, suffix: '/B' })).toBe(
      'Strada Negoveanu 2/B',
    );
    expect(buildAddressLabel('Calea Poplăcii', { n: 12, suffix: ' bis' })).toBe(
      'Calea Poplăcii 12 bis',
    );
  });

  it('a typed "2 a" is shown as 2A (letter case only)', () => {
    const p = parseAddressQuery('negoveanu 2 a');
    expect(p.number && buildAddressLabel('Strada Negoveanu', p.number)).toBe('Strada Negoveanu 2A');
  });

  it('appends bl./sc./ap. extras', () => {
    expect(
      buildAddressLabel('Strada Negoveanu', { n: 2, suffix: '' }, { bloc: 'B5', scara: '2' }),
    ).toBe('Strada Negoveanu 2, bl. B5, sc. 2');
    expect(buildAddressLabel('Strada X', { n: 1, suffix: '' }, { ap: '7' })).toBe(
      'Strada X 1, ap. 7',
    );
  });

  it('is at most 80 characters: extras go first, then the street is shortened', () => {
    const long = 'Strada ' + 'Foarte Lunga '.repeat(5).trim();
    const withExtras = buildAddressLabel(
      long,
      { n: 2, suffix: '' },
      { bloc: 'B5', scara: '2', ap: '11' },
    );
    expect(withExtras.length).toBeLessThanOrEqual(80);
    expect(withExtras).toContain(' 2');
    const huge = buildAddressLabel('S'.repeat(200), { n: 12, suffix: 'A' }, { bloc: 'B' });
    expect(huge.length).toBeLessThanOrEqual(80);
    expect(huge.endsWith(' 12A')).toBe(true);
    // extras that fit are kept, the last ones are dropped first
    const mid = buildAddressLabel(
      'Strada ' + 'x'.repeat(50),
      { n: 2, suffix: '' },
      { bloc: 'B5', scara: '2', ap: '11' },
    );
    expect(mid.length).toBeLessThanOrEqual(80);
    expect(mid).toContain('bl. B5');
  });

  it('property: never longer than 80 and always ends the street part with the number', () => {
    fc.assert(
      fc.property(
        fc.string({ minLength: 1, maxLength: 150 }),
        fc.integer({ min: 1, max: 9999 }),
        fc.constantFrom('', 'A', '/B', ' bis'),
        fc.option(fc.stringMatching(/^[A-Z0-9]{1,6}$/), { nil: undefined }),
        (street, n, suffix, bloc) => {
          const label = buildAddressLabel(street, { n, suffix }, bloc ? { bloc } : {});
          expect(label.length).toBeLessThanOrEqual(80);
          if (street.trim().length <= 60 && !bloc) {
            expect(label.endsWith(`${n}${suffix}`)).toBe(true);
          }
        },
      ),
      { numRuns: 200 },
    );
  });
});

describe('estimatePosition', () => {
  // A street along the equator-ish line: 0.0001 deg lng ~ 7.8 m at lat 45.78.
  const at = (n: number, x: number): KnownNumber => ({ n, suffix: '', lat: 45.78, lng: 24.1 + x });

  it('interpolates between the nearest lower and higher numbers of the same parity', () => {
    const known = [at(2, 0), at(6, 0.002)]; // about 156 m apart
    const e = estimatePosition(known, 4);
    expect(e?.method).toBe('interpolated');
    expect(e?.lng).toBeCloseTo(24.101, 6);
    expect(e?.lat).toBeCloseTo(45.78, 6);
    const q = estimatePosition(known, 3 + 1);
    expect(q).toEqual(e);
  });

  it('interpolates linearly by number', () => {
    const known = [at(2, 0), at(10, 0.0016)];
    expect(estimatePosition(known, 4)?.lng).toBeCloseTo(24.1004, 6);
    expect(estimatePosition(known, 8)?.lng).toBeCloseTo(24.1012, 6);
  });

  it('uses the same side of the street only', () => {
    // odd numbers 1 and 7 are known; target 4 is even: odd points are never bracketing it
    const known = [at(1, 0), at(7, 0.001), at(2, 0.0002), at(8, 0.0012)];
    const e = estimatePosition(known, 4);
    expect(e?.method).toBe('interpolated');
    // between 2 (0.0002) and 8 (0.0012): fraction 2/6
    expect(e?.lng).toBeCloseTo(24.1 + 0.0002 + (0.001 * 2) / 6, 6);
  });

  it('falls back to the nearest number when the gap is over 300 m', () => {
    const known = [at(2, 0), at(8, 0.01)]; // about 780 m
    const e = estimatePosition(known, 3);
    expect(e?.method).toBe('nearest');
    // 2 is the nearest same-parity? 3 is odd: neither is odd; 2 costs 1+1, 8 costs 5+1
    expect(e?.lng).toBeCloseTo(24.1, 6);
  });

  it('never extrapolates: a number beyond the known range takes the nearest known point', () => {
    const known = [at(4, 0), at(8, 0.001)];
    const e = estimatePosition(known, 2);
    expect(e).toMatchObject({ method: 'nearest', lat: 45.78, lng: 24.1 });
    const f = estimatePosition(known, 40);
    expect(f).toMatchObject({ method: 'nearest', lng: 24.101 });
  });

  it('a single known number is used for any target on that street', () => {
    const e = estimatePosition([at(4, 0)], 2);
    expect(e).toEqual({ lat: 45.78, lng: 24.1, method: 'nearest' });
    expect(estimatePosition([at(4, 0)], 51)?.method).toBe('nearest');
  });

  it('prefers the same parity and, at equal cost, the lower number', () => {
    // target 5 (odd): 4 costs 1+1 = 2, 7 costs 2: same parity wins
    expect(estimatePosition([at(4, 0), at(7, 0.01)], 5)?.lng).toBeCloseTo(24.11, 6);
    // equal distance and parity both sides: 3 and 7 around 5 but too far apart for interpolation
    expect(estimatePosition([at(3, 0), at(7, 0.01)], 5)?.lng).toBeCloseTo(24.1, 6);
    // a closer number on the other side beats a far same-parity one
    expect(estimatePosition([at(4, 0), at(21, 0.02)], 5)?.lng).toBeCloseTo(24.1, 6);
  });

  it('uses the point of the same number when only another suffix is known', () => {
    const known: KnownNumber[] = [{ n: 2, suffix: 'A', lat: 45.7801, lng: 24.1001 }, at(6, 0.001)];
    expect(estimatePosition(known, 2)).toEqual({ lat: 45.7801, lng: 24.1001, method: 'nearest' });
  });

  it('falls back to the street point, then to null', () => {
    expect(estimatePosition([], 4, { lat: 45.79, lng: 24.11 })).toEqual({
      lat: 45.79,
      lng: 24.11,
      method: 'street',
    });
    expect(estimatePosition([], 4)).toBeNull();
    expect(estimatePosition([], 4, null)).toBeNull();
    expect(estimatePosition([], Number.NaN, { lat: 45.79, lng: 24.11 })?.method).toBe('street');
  });

  it('known numbers win over the street point', () => {
    expect(estimatePosition([at(4, 0)], 2, { lat: 45.9, lng: 24.9 })?.method).toBe('nearest');
  });

  it('rounds to 6 decimals', () => {
    const e = estimatePosition([at(2, 0), at(8, 0.0007)], 3 + 1, undefined);
    expect(String(e?.lng).split('.')[1]?.length ?? 0).toBeLessThanOrEqual(6);
  });

  it('is deterministic for any order of the input and ties go to the lower number', () => {
    const a = at(4, 0);
    const b = at(8, 0.004);
    // target 6: equal distance to both, gap 312 m > 300, so the tie decides: the lower number
    expect(haversineM(a, b)).toBeGreaterThan(300);
    expect(estimatePosition([a, b], 6)?.lng).toBeCloseTo(24.1, 6);
    expect(estimatePosition([b, a], 6)).toEqual(estimatePosition([a, b], 6));
  });

  it('property: an interpolated point lies between its two neighbours and the input order is irrelevant', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 40 }),
        fc.integer({ min: 1, max: 20 }),
        fc.integer({ min: 1, max: 19 }),
        fc.double({ min: 0.0001, max: 0.003, noNaN: true }),
        (lowRaw, spanRaw, offRaw, dx) => {
          const lo = lowRaw * 2;
          const hi = lo + spanRaw * 2;
          const target = lo + Math.min(offRaw, spanRaw * 2 - 1);
          const known = [at(lo, 0), at(hi, dx)];
          const e = estimatePosition(known, target);
          const r = estimatePosition([...known].reverse(), target);
          expect(r).toEqual(e);
          if (e && e.method === 'interpolated') {
            expect(e.lng).toBeGreaterThanOrEqual(24.1 - 1e-6);
            expect(e.lng).toBeLessThanOrEqual(24.1 + dx + 1e-6);
          }
        },
      ),
      { numRuns: 200 },
    );
  });

  it('property: with any known point the result is never null', () => {
    fc.assert(
      fc.property(
        fc.array(fc.integer({ min: 1, max: 200 }), { minLength: 1, maxLength: 12 }),
        fc.integer({ min: 1, max: 300 }),
        (ns, target) => {
          const e = estimatePosition(
            ns.map((n, i) => at(n, i * 0.0003)),
            target,
          );
          expect(e).not.toBeNull();
        },
      ),
      { numRuns: 200 },
    );
  });
});

describe('parseKnownAddressName', () => {
  it.each([
    ['Strada Negoveanu 4', 'Strada Negoveanu', 4, ''],
    ['Strada Lucian Blaga 2A', 'Strada Lucian Blaga', 2, 'A'],
    ['Strada X 3/B', 'Strada X', 3, '/B'],
    ['Strada Podului 66/1', 'Strada Podului', 66, '/1'],
    ['Strada Gladiolelor 4-8', 'Strada Gladiolelor', 4, ''],
    ['Calea Dumbrăvii 17A-B', 'Calea Dumbrăvii', 17, 'A'],
    ['Strada Hațegului 3A-3B', 'Strada Hațegului', 3, 'A'],
    ['Calea Poplăcii 11 Bis', 'Calea Poplăcii', 11, ' bis'],
    ['Strada 9 Mai 12', 'Strada 9 Mai', 12, ''],
  ])('%s', (name, street, n, suffix) => {
    expect(parseKnownAddressName(name)).toEqual({ street, n, suffix });
  });

  it.each([
    'Calea Dumbrăvii Bl. 16 Sc. A',
    'Bulevardul Vasile Milea Bl. 2 sc. B',
    'Strada Negoveanu',
    'Strada X Bl. 5',
    'Strada X Sc. 2',
    '4',
    '',
  ])('ignores %s', (name) => {
    expect(parseKnownAddressName(name)).toBeNull();
  });
});

describe('street candidates', () => {
  const row = (name: string, kind: string, locality: string, lat: number, lng: number) => ({
    name,
    kind,
    locality,
    lat,
    lng,
  });

  it('groups addresses and the street row of one street per locality', () => {
    const out = groupStreetCandidates(
      [
        row('Strada Negoveanu 4', 'address', 'Sibiu', 45.7856, 24.1747),
        row('Strada Negoveanu', 'street', 'Sibiu', 45.786, 24.175),
        row('Strada Negoveanu 6', 'address', 'Sibiu', 45.7857, 24.1749),
        row('Strada Altfel 4', 'address', 'Sibiu', 45.7, 24.1),
      ],
      'negoveanu',
    );
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({
      locality: 'Sibiu',
      name: 'Strada Negoveanu',
      streetPoint: { lat: 45.786, lng: 24.175 },
    });
    expect(out[0]?.known.map((k) => k.n)).toEqual([4, 6]);
  });

  it('works with addresses only (no street row)', () => {
    const out = groupStreetCandidates(
      [row('Strada Negoveanu 4', 'address', 'Sibiu', 45.7856, 24.1747)],
      'negoveanu',
    );
    expect(out[0]?.streetPoint).toBeNull();
    expect(out[0]?.known).toHaveLength(1);
  });

  it('keeps at most two localities and prefers exact street names', () => {
    const rows = [
      row('Strada Mihai Eminescu 1', 'address', 'Sibiu', 45.78, 24.15),
      row('Strada Eminescu 2', 'address', 'Sibiu', 45.79, 24.16),
      row('Strada Eminescu 8', 'address', 'Sibiu', 45.791, 24.161),
      row('Strada Eminescu 4', 'address', 'Cisnădie', 45.7, 24.1),
      row('Strada Eminescu 4', 'address', 'Șelimbăr', 45.74, 24.18),
      row('Strada Eminescu 5', 'address', 'Șelimbăr', 45.741, 24.181),
      row('Strada Eminescu 6', 'address', 'Șelimbăr', 45.742, 24.182),
    ];
    const out = groupStreetCandidates(rows, 'eminescu');
    expect(out).toHaveLength(2);
    expect(out.map((c) => c.locality)).toEqual(['Șelimbăr', 'Sibiu']);
    expect(out[1]?.name).toBe('Strada Eminescu');
  });

  it('matches without diacritics, partial last word, ignores the locality text and other kinds', () => {
    const rows = [
      row('Strada Șelimbărului 3', 'address', 'Sibiu', 45.7, 24.1),
      row('Șelimbăr', 'area', 'Șelimbăr', 45.74, 24.18),
      row('Shopping City Sibiu', 'poi', 'Sibiu', 45.74, 24.18),
    ];
    expect(groupStreetCandidates(rows, 'selimbar')).toHaveLength(1);
    expect(groupStreetCandidates(rows, 'sibiu')).toHaveLength(0);
    expect(groupStreetCandidates(rows, 'shopping')).toHaveLength(0);
  });

  it('street match score', () => {
    expect(streetMatchScore(['stefan', 'cel', 'mare'], ['stefan', 'cel', 'mare'])).toBe(2);
    expect(streetMatchScore(['stefan', 'cel', 'mare'], ['cel', 'mare'])).toBe(1);
    expect(streetMatchScore(['stefan', 'cel', 'mare'], ['stef'])).toBe(1);
    expect(streetMatchScore(['stefan', 'cel', 'mare'], ['cel', 'ma'])).toBe(1);
    expect(streetMatchScore(['stefan', 'cel', 'mare'], ['ste', 'mare'])).toBe(0);
    expect(streetMatchScore(['a'], [])).toBe(0);
  });

  it('exact number check ignores letter case', () => {
    const known: KnownNumber[] = [
      { n: 2, suffix: 'A', lat: 1, lng: 1 },
      { n: 4, suffix: '', lat: 1, lng: 1 },
    ];
    expect(hasExactNumber(known, { n: 4, suffix: '' })).toBe(true);
    expect(hasExactNumber(known, { n: 2, suffix: 'a' })).toBe(true);
    expect(hasExactNumber(known, { n: 2, suffix: '' })).toBe(false);
    expect(hasExactNumber(known, { n: 6, suffix: '' })).toBe(false);
  });
});

describe('approximatePlaceId', () => {
  it('is stable, URL-safe and never a uuid', () => {
    const a = approximatePlaceId('Șelimbăr', 'Strada Negoveanu', { n: 2, suffix: 'A' });
    expect(a).toBe(approximatePlaceId('selimbar', 'strada  negoveanu', { n: 2, suffix: 'a' }));
    expect(a).toMatch(/^approx:[A-Za-z0-9_-]+$/);
    expect(a).not.toBe(approximatePlaceId('Sibiu', 'Strada Negoveanu', { n: 2, suffix: 'A' }));
    expect(a).not.toBe(approximatePlaceId('Șelimbăr', 'Strada Negoveanu', { n: 2, suffix: '' }));
  });
});

describe('helpers', () => {
  it('normalizeForMatch folds both cedilla and comma-below forms', () => {
    expect(normalizeForMatch('  ȘşȚţ ĂÎÂ  x ')).toBe('sstt aia x');
  });
  it('haversine: 0.001 deg of latitude is about 111 m', () => {
    expect(haversineM({ lat: 45, lng: 24 }, { lat: 45.001, lng: 24 })).toBeGreaterThan(110);
    expect(haversineM({ lat: 45, lng: 24 }, { lat: 45.001, lng: 24 })).toBeLessThan(112);
  });
});
