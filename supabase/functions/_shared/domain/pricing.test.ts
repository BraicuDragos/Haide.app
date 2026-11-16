import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { DomainError } from './errors.ts';
import {
  priceTable,
  quoteUpTo,
  ratePerKmMicro,
  relock,
  seatPriceBani,
  segmentCostMicro,
  tripCostBani,
} from './pricing.ts';

// Reference rates v1 (pricing.md §3), expressed the way the database stores them.
const PETROL = ratePerKmMicro(700, 9810); // 0.6867 RON/km
const DIESEL = ratePerKmMicro(600, 10850); // 0.6510 RON/km
const LPG = ratePerKmMicro(900, 4760);
const HYBRID = ratePerKmMicro(500, 9810);
const ELECTRIC = ratePerKmMicro(1700, 1400);

const RUNS = { numRuns: 2000, seed: 20261115 };

describe('rates (pricing.md §3)', () => {
  it('derives micro-RON per km from consumption and energy price', () => {
    expect(PETROL).toBe(686_700);
    expect(DIESEL).toBe(651_000);
    expect(LPG).toBe(428_400);
    expect(HYBRID).toBe(490_500);
    expect(ELECTRIC).toBe(238_000);
  });

  it('matches the displayed RON/km values within rounding', () => {
    // pricing.md shows rates rounded to 3 decimals: the exact values differ by less than 0.001.
    for (const [exact, shown] of [
      [PETROL, 0.687],
      [DIESEL, 0.651],
      [LPG, 0.428],
      [HYBRID, 0.491],
      [ELECTRIC, 0.238],
    ] as const) {
      expect(Math.abs(exact / 1e6 - shown)).toBeLessThan(0.001);
    }
  });
});

describe('worked examples (pricing.md §5), to the exact bani', () => {
  const prices = (routeM: number, rate: number) =>
    [1, 2, 3, 4].map((n) => seatPriceBani(routeM, rate, n, false));

  it('Trip A: Cisnădie to Piața Mare, 11.514 km, petrol', () => {
    expect(tripCostBani(11_514, PETROL)).toBe(790); // 7.90 (pricing.md rounds to 7.91 with 0.687)
    expect(prices(11_514, PETROL).slice(0, 3)).toEqual([390, 260, 190]);
    expect(quoteUpTo(11_514, PETROL, false)).toBe(390);
  });

  it('Trip B: Șelimbăr to Zona Industrială Vest, 9.588 km, diesel', () => {
    expect(tripCostBani(9_588, DIESEL)).toBe(624);
    expect(prices(9_588, DIESEL).slice(0, 3)).toEqual([310, 200, 150]);
  });

  it('Trip C: Hipodrom to the old town, 4.234 km, petrol', () => {
    expect(tripCostBani(4_234, PETROL)).toBe(290);
    expect(prices(4_234, PETROL).slice(0, 3)).toEqual([140, 90, 70]);
  });

  it('mixed segments on Trip A with n = 2: P1 rides everything, P2 boards at Shopping City', () => {
    const p1 = seatPriceBani(11_514, PETROL, 2, false);
    const p2 = seatPriceBani(5_390, PETROL, 2, false);
    expect(p1).toBe(260);
    expect(p2).toBe(120);
    // The driver collects 3.80 RON, at most 48 % of the trip fuel cost. Cap: 3.80 <= 5.27.
    expect(p1 + p2).toBe(380);
    expect((p1 + p2) * 10_000 * 3).toBeLessThanOrEqual(2 * segmentCostMicro(11_514, PETROL));
  });

  it('a four-passenger full route never returns more than 80 % of the fuel', () => {
    const [, , , four] = prices(11_514, PETROL);
    expect(four).toBe(150);
    expect(4 * (four ?? 0) * 10_000 * 5).toBeLessThanOrEqual(4 * segmentCostMicro(11_514, PETROL));
  });
});

describe('priceTable, quoteUpTo, tripCostBani', () => {
  it('builds one row per seat of the vehicle', () => {
    expect(priceTable(9_588, DIESEL, 3)).toEqual([
      { passengers: 1, priceBani: 310 },
      { passengers: 2, priceBani: 200 },
      { passengers: 3, priceBani: 150 },
    ]);
    expect(priceTable(9_588, DIESEL, 1)).toEqual([{ passengers: 1, priceBani: 310 }]);
  });

  it('a free ride is zero everywhere', () => {
    expect(priceTable(9_588, DIESEL, 4, true).map((r) => r.priceBani)).toEqual([0, 0, 0, 0]);
    expect(quoteUpTo(9_588, DIESEL, true)).toBe(0);
    expect(seatPriceBani(9_588, DIESEL, 3, true)).toBe(0);
  });

  it('the first row equals quoteUpTo', () => {
    expect(priceTable(11_514, PETROL, 4)[0]?.priceBani).toBe(quoteUpTo(11_514, PETROL, false));
  });

  it('very short segments can be free of charge (no floor, pricing.md §4)', () => {
    expect(seatPriceBani(1_000, ELECTRIC, 4, false)).toBe(0);
  });

  it('rejects out-of-range input with a DomainError', () => {
    expect(() => priceTable(1_000, PETROL, 0)).toThrow(DomainError);
    expect(() => priceTable(1_000, PETROL, 5)).toThrow(DomainError);
    expect(() => seatPriceBani(1_000, PETROL, 0, false)).toThrow(DomainError);
    expect(() => seatPriceBani(1_000, PETROL, 1.5, false)).toThrow(DomainError);
    expect(() => segmentCostMicro(-1, PETROL)).toThrow(DomainError);
    expect(() => segmentCostMicro(10.5, PETROL)).toThrow(DomainError);
    expect(() => ratePerKmMicro(700, -1)).toThrow(DomainError);
    expect(() => relock(-1, 10)).toThrow(DomainError);
    expect(() => tripCostBani(Number.NaN, PETROL)).toThrow(DomainError);
  });
});

describe('relock (price only goes down)', () => {
  it('keeps the lower of the two', () => {
    expect(relock(390, 260)).toBe(260);
    expect(relock(260, 390)).toBe(260);
    expect(relock(120, 120)).toBe(120);
    expect(relock(0, 50)).toBe(0);
  });

  it('example: P1 confirmed at 3.90, then P2 joins on the full route: P1 relocks to 2.60', () => {
    const p1Alone = seatPriceBani(11_514, PETROL, 1, false);
    const p1Now = seatPriceBani(11_514, PETROL, 2, false);
    expect(relock(p1Alone, p1Now)).toBe(260);
    // P2 cancels: n drops back to 1, the lock keeps 2.60.
    expect(relock(260, seatPriceBani(11_514, PETROL, 1, false))).toBe(260);
  });
});

// ---- properties ---------------------------------------------------------------------------------

const rateArb = fc.integer({ min: 100_000, max: 1_500_000 });
const routeArb = fc.integer({ min: 1_000, max: 40_000 });
const nArb = fc.integer({ min: 1, max: 4 });

describe('properties (fast-check, seeded)', () => {
  it('(b) the sum of prices never exceeds n/(n+1) x the trip cost', () => {
    fc.assert(
      fc.property(
        rateArb,
        routeArb,
        nArb,
        fc.array(fc.double({ min: 0, max: 1, noNaN: true }), { minLength: 4, maxLength: 4 }),
        (rate, routeM, n, fractions) => {
          // n passengers, each riding a random sub-segment of the route.
          const segments = fractions
            .slice(0, n)
            .map((f) => Math.max(1_000, Math.min(routeM, Math.round(routeM * f))));
          const sumBani = segments.reduce((s, m) => s + seatPriceBani(m, rate, n, false), 0);
          // sumBani x 10_000 micro <= n/(n+1) x tripCostMicro, in integers.
          return sumBani * 10_000 * (n + 1) <= n * segmentCostMicro(routeM, rate);
        },
      ),
      RUNS,
    );
  });

  it('(c) a price is at most half the cost of the passenger segment', () => {
    fc.assert(
      fc.property(rateArb, routeArb, nArb, (rate, segmentM, n) => {
        return (
          seatPriceBani(segmentM, rate, n, false) * 10_000 * 2 <= segmentCostMicro(segmentM, rate)
        );
      }),
      RUNS,
    );
  });

  it('(d) always a multiple of 10 bani, and rounded down, never to the nearest', () => {
    fc.assert(
      fc.property(rateArb, routeArb, nArb, (rate, segmentM, n) => {
        const price = seatPriceBani(segmentM, rate, n, false);
        const share = segmentCostMicro(segmentM, rate) / (n + 1);
        return (
          price % 10 === 0 &&
          price * 10_000 <= share &&
          // the next step up would exceed the share: this is the largest allowed multiple
          (price + 10) * 10_000 > share
        );
      }),
      RUNS,
    );
  });

  it('(e) relock never increases and never exceeds the new price', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 10_000 }),
        fc.integer({ min: 0, max: 10_000 }),
        (a, b) => {
          const r = relock(a, b);
          return r <= a && r <= b && (r === a || r === b);
        },
      ),
      RUNS,
    );
  });

  it('(e) prices are non-increasing as more passengers join, so relock keeps the first value', () => {
    fc.assert(
      fc.property(rateArb, routeArb, (rate, routeM) => {
        const table = priceTable(routeM, rate, 4);
        let locked = table[0]?.priceBani ?? 0;
        for (const row of table) {
          const next = relock(locked, row.priceBani);
          if (next > locked) return false;
          locked = next;
        }
        // The price table itself never rises with n.
        return table.every((row, i) => i === 0 || row.priceBani <= (table[i - 1]?.priceBani ?? 0));
      }),
      RUNS,
    );
  });

  it('(e) "up to" holds: any later price is at most the quote', () => {
    fc.assert(
      fc.property(rateArb, routeArb, nArb, (rate, segmentM, n) => {
        return seatPriceBani(segmentM, rate, n, false) <= quoteUpTo(segmentM, rate, false);
      }),
      RUNS,
    );
  });

  it('a free ride is always zero', () => {
    fc.assert(
      fc.property(rateArb, routeArb, nArb, (rate, segmentM, n) => {
        return seatPriceBani(segmentM, rate, n, true) === 0;
      }),
      RUNS,
    );
  });

  it('prices are monotone in distance', () => {
    fc.assert(
      fc.property(rateArb, routeArb, routeArb, nArb, (rate, a, b, n) => {
        const [lo, hi] = a <= b ? [a, b] : [b, a];
        return seatPriceBani(lo, rate, n, false) <= seatPriceBani(hi, rate, n, false);
      }),
      RUNS,
    );
  });
});
