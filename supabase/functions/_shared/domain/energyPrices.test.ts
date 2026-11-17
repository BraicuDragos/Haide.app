import { describe, expect, it } from 'vitest';
import {
  decideEnergyPrice,
  isLargeChange,
  truncateToMinute,
  unitFor,
  type LatestEnergyPrice,
} from './energyPrices.ts';
import { DomainError } from './errors.ts';

const NOW = new Date('2026-11-17T10:00:00Z');
const MIN = 60_000;
const DAY = 86_400_000;

const body = (over: Record<string, unknown> = {}) => ({
  fuelType: 'petrol' as const,
  priceMilli: 10_000,
  consumptionCenti: 700,
  sourceNote: 'National average, 17 Nov 2026',
  ...over,
});
const latest = (over: Partial<LatestEnergyPrice> = {}): LatestEnergyPrice => ({
  priceMilli: 10_000,
  consumptionCenti: 700,
  effectiveFrom: new Date('2026-11-15T00:00:00Z'),
  ...over,
});

function failure(fn: () => unknown): DomainError {
  try {
    fn();
  } catch (e) {
    if (e instanceof DomainError) return e;
    throw e;
  }
  throw new Error('expected a DomainError');
}

describe('isLargeChange', () => {
  it('passes exactly 30 percent and fails beyond it, up and down', () => {
    expect(isLargeChange(10_000, 12_999)).toBe(false); // 29.99 %
    expect(isLargeChange(10_000, 13_000)).toBe(false); // 30.00 %
    expect(isLargeChange(10_000, 13_001)).toBe(true); // 30.01 %
    expect(isLargeChange(10_000, 7_001)).toBe(false); // -29.99 %
    expect(isLargeChange(10_000, 7_000)).toBe(false); // -30.00 %
    expect(isLargeChange(10_000, 6_999)).toBe(true); // -30.01 %
  });

  it('uses integer math, not floats', () => {
    expect(isLargeChange(9_810, 12_753)).toBe(false); // exactly +30 %
    expect(isLargeChange(9_810, 12_754)).toBe(true);
  });

  it('never flags an unchanged value or a missing baseline', () => {
    expect(isLargeChange(700, 700)).toBe(false);
    expect(isLargeChange(0, 700)).toBe(false);
    expect(isLargeChange(-1, 700)).toBe(false);
    expect(isLargeChange(700.5, 900)).toBe(false);
  });
});

describe('unitFor', () => {
  it('is kWh for electric and litres otherwise', () => {
    expect(unitFor('electric')).toBe('kWh');
    for (const f of ['petrol', 'diesel', 'lpg', 'hybrid'] as const) expect(unitFor(f)).toBe('l');
  });
});

describe('decideEnergyPrice: ranges and note', () => {
  it('accepts the limits', () => {
    for (const [p, c] of [
      [100, 100],
      [50_000, 5_000],
    ] as const) {
      const d = decideEnergyPrice(body({ priceMilli: p, consumptionCenti: c }), NOW, null);
      expect(d.override).toBe(false);
    }
  });

  it('rejects out of range and non-integer numbers with one field each', () => {
    for (const [field, value] of [
      ['priceMilli', 99],
      ['priceMilli', 50_001],
      ['priceMilli', 100.5],
      ['consumptionCenti', 99],
      ['consumptionCenti', 5_001],
    ] as const) {
      const e = failure(() => decideEnergyPrice(body({ [field]: value }), NOW, null));
      expect(e.code).toBe('VALIDATION_FAILED');
      expect(e.fields).toEqual({ [field]: 'out_of_range' });
    }
  });

  it('requires a source note of 1 to 200 characters after trimming', () => {
    expect(failure(() => decideEnergyPrice(body({ sourceNote: '   ' }), NOW, null)).fields).toEqual(
      {
        sourceNote: 'required',
      },
    );
    expect(
      failure(() => decideEnergyPrice(body({ sourceNote: 'x'.repeat(201) }), NOW, null)).fields,
    ).toEqual({ sourceNote: 'too_long' });
    expect(() => decideEnergyPrice(body({ sourceNote: 'x'.repeat(200) }), NOW, null)).not.toThrow();
  });
});

describe('decideEnergyPrice: effectiveFrom', () => {
  it('defaults to now, truncated to the minute', () => {
    const d = decideEnergyPrice(body(), new Date('2026-11-17T10:00:42Z'), null);
    expect(d.effectiveFrom.toISOString()).toBe('2026-11-17T10:00:00.000Z');
    expect(truncateToMinute(new Date('2026-11-17T10:00:59.999Z')).toISOString()).toBe(
      '2026-11-17T10:00:00.000Z',
    );
  });

  it('allows 5 minutes back and 30 days ahead, not a minute more', () => {
    const at = (ms: number) => new Date(NOW.getTime() + ms).toISOString();
    expect(() => decideEnergyPrice(body({ effectiveFrom: at(-5 * MIN) }), NOW, null)).not.toThrow();
    expect(
      failure(() => decideEnergyPrice(body({ effectiveFrom: at(-6 * MIN) }), NOW, null)).fields,
    ).toEqual({ effectiveFrom: 'past' });
    expect(() => decideEnergyPrice(body({ effectiveFrom: at(30 * DAY) }), NOW, null)).not.toThrow();
    expect(
      failure(() => decideEnergyPrice(body({ effectiveFrom: at(30 * DAY + MIN) }), NOW, null))
        .fields,
    ).toEqual({ effectiveFrom: 'too_far' });
  });

  it('rejects an unreadable date', () => {
    expect(
      failure(() => decideEnergyPrice(body({ effectiveFrom: 'tomorrow' }), NOW, null)).fields,
    ).toEqual({ effectiveFrom: 'invalid' });
  });

  it('must be later than the latest row of the fuel (forward-only)', () => {
    const scheduled = latest({ effectiveFrom: new Date('2026-11-17T11:00:00Z') });
    const e = failure(() =>
      decideEnergyPrice(body({ effectiveFrom: '2026-11-17T11:00:00Z' }), NOW, scheduled),
    );
    expect(e.fields).toEqual({ effectiveFrom: 'not_after_latest' });
    expect(() =>
      decideEnergyPrice(body({ effectiveFrom: '2026-11-17T11:01:00Z' }), NOW, scheduled),
    ).not.toThrow();
    // A scheduled latest row blocks "now" as well.
    expect(failure(() => decideEnergyPrice(body(), NOW, scheduled)).fields).toEqual({
      effectiveFrom: 'not_after_latest',
    });
  });
});

describe('decideEnergyPrice: the 30 percent guard', () => {
  it('passes +10 % and exactly +30 % without an override', () => {
    expect(decideEnergyPrice(body({ priceMilli: 11_000 }), NOW, latest()).override).toBe(false);
    expect(decideEnergyPrice(body({ priceMilli: 13_000 }), NOW, latest()).override).toBe(false);
  });

  it('answers 409 LARGE_CHANGE naming the field, for price, consumption or both', () => {
    const price = failure(() => decideEnergyPrice(body({ priceMilli: 14_000 }), NOW, latest()));
    expect(price.code).toBe('LARGE_CHANGE');
    expect(price.fields).toEqual({ priceMilli: 'large_change' });
    const cons = failure(() => decideEnergyPrice(body({ consumptionCenti: 1_000 }), NOW, latest()));
    expect(cons.fields).toEqual({ consumptionCenti: 'large_change' });
    const both = failure(() =>
      decideEnergyPrice(body({ priceMilli: 4_000, consumptionCenti: 1_000 }), NOW, latest()),
    );
    expect(both.fields).toEqual({ priceMilli: 'large_change', consumptionCenti: 'large_change' });
  });

  it('a drop of more than 30 % needs the override too', () => {
    expect(failure(() => decideEnergyPrice(body({ priceMilli: 6_999 }), NOW, latest())).code).toBe(
      'LARGE_CHANGE',
    );
  });

  it('the override lets it through and is reported for the audit row', () => {
    const d = decideEnergyPrice(
      body({ priceMilli: 14_000, overrideLargeChange: true }),
      NOW,
      latest(),
    );
    expect(d.override).toBe(true);
  });

  it('the override does not matter when the change is small', () => {
    expect(decideEnergyPrice(body({ overrideLargeChange: true }), NOW, latest()).override).toBe(
      false,
    );
  });

  it('has no baseline for the first row of a fuel: no guard', () => {
    expect(decideEnergyPrice(body({ priceMilli: 50_000 }), NOW, null).override).toBe(false);
  });

  it('range errors win over the guard, the date over the guard', () => {
    expect(failure(() => decideEnergyPrice(body({ priceMilli: 99 }), NOW, latest())).code).toBe(
      'VALIDATION_FAILED',
    );
    const e = failure(() =>
      decideEnergyPrice(
        body({ priceMilli: 14_000, effectiveFrom: '2026-11-10T00:00:00Z' }),
        NOW,
        latest(),
      ),
    );
    expect(e.fields).toEqual({ effectiveFrom: 'past' });
  });
});

describe('decideEnergyPrice: unit', () => {
  it('follows the fuel type', () => {
    expect(decideEnergyPrice(body({ fuelType: 'electric' }), NOW, null).unit).toBe('kWh');
    expect(decideEnergyPrice(body({ fuelType: 'diesel' }), NOW, null).unit).toBe('l');
  });
});
