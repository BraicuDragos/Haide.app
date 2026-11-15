import { describe, expect, it } from 'vitest';
import en from './en.json';

// ADR 0020: "Haide!" (launch.haide) is the only exclamation mark allowed in product copy.
describe('copy voice', () => {
  it('has no exclamation marks except launch.haide', () => {
    const offenders = Object.entries(en as Record<string, string>)
      .filter(([k, v]) => v.includes('!') && k !== 'launch.haide')
      .map(([k]) => k);
    expect(offenders).toEqual([]);
    expect((en as Record<string, string>)['launch.haide']).toBe('Haide!');
  });
});
