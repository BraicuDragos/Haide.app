import { describe, expect, it } from 'vitest';
import { CORRIDOR_AREAS, LAUNCH_CORRIDORS, classifyCorridor } from './corridors.ts';

describe('classifyCorridor', () => {
  it('classifies the three launch corridors', () => {
    expect(classifyCorridor('Șelimbăr', 'Centrul Istoric')).toBe('south');
    expect(classifyCorridor('Cisnădie', 'Piața Mare')).toBe('south');
    expect(classifyCorridor('Șelimbăr', 'Zona Industrială Vest')).toBe('south'); // tie: south first
    expect(classifyCorridor('Vasile Aaron', 'Zona Industrială Vest')).toBe('west');
    expect(classifyCorridor('Turnișor', 'Aeroport')).toBe('west');
    expect(classifyCorridor('Hipodrom II', 'Centrul Istoric')).toBe('campus');
    expect(classifyCorridor('Ștrand', 'ULBS')).toBe('campus');
  });

  it('the corridor with the most matching ends wins', () => {
    expect(classifyCorridor('Turnișor', 'Zona Industrială Vest')).toBe('west');
    expect(classifyCorridor('Hipodrom III', 'Zona Industrială Vest')).toBe('west'); // 1 vs 1: order
    expect(classifyCorridor('Vasile Aaron', 'Turnișor')).toBe('west');
    expect(classifyCorridor('Șelimbăr', 'Hipodrom II')).toBe('south'); // 1 vs 1: order
    expect(classifyCorridor('Hipodrom II', 'Hipodrom IV')).toBe('campus');
  });

  it('ignores case, diacritics, punctuation and cedilla spellings', () => {
    expect(classifyCorridor('SELIMBAR', null)).toBe('south');
    expect(classifyCorridor('  șelimbăr ', undefined)).toBe('south');
    expect(classifyCorridor('Şelimbăr', null)).toBe('south'); // cedilla
    expect(classifyCorridor('nord-vest', null)).toBe('west');
    expect(classifyCorridor('NORD   -   VEST', null)).toBe('west');
  });

  it('is "other" for unknown, shared-centre or missing areas', () => {
    expect(classifyCorridor('Centrul Istoric', 'Centrul Civic')).toBe('other');
    expect(classifyCorridor('Rășinari', 'Avrig')).toBe('other');
    expect(classifyCorridor(null, null)).toBe('other');
    expect(classifyCorridor('', undefined)).toBe('other');
  });

  it('every corridor name set is non-empty and the corridors do not overlap', () => {
    const seen = new Map<string, string>();
    for (const c of LAUNCH_CORRIDORS) {
      expect(CORRIDOR_AREAS[c].length).toBeGreaterThan(0);
      for (const name of CORRIDOR_AREAS[c]) {
        const key = name.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();
        expect(seen.get(key), `${name} is in two corridors`).toBeUndefined();
        seen.set(key, c);
      }
    }
  });
});
