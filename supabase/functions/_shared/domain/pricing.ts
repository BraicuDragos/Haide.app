import { DomainError } from './errors.ts';
import { MAX_SEATS, PRICE_STEP_BANI } from './rules.ts';

/**
 * Pricing engine (architecture §6, pricing.md, ADR 0003). Pure, integer arithmetic only, no I/O.
 * Server-side only: the web app never imports this module (ESLint enforces it).
 *
 * Units
 * - money: bani (1 RON = 100 bani)
 * - energy price: milli-RON per unit (9810 = 9.81 RON/l or per kWh)
 * - consumption: centi-units per 100 km (700 = 7.00 l/100 km)
 * - rate: micro-RON per km (686_700 = 0.6867 RON/km)
 * - distance: metres
 */

const MICRO_PER_BANI = 10_000; // 1 RON = 1_000_000 micro-RON = 100 bani
const STEP_MICRO = PRICE_STEP_BANI * MICRO_PER_BANI; // 0.10 RON = 100_000 micro-RON

export type PriceRow = { passengers: number; priceBani: number };

const invalid = (what: string): never => {
  throw new DomainError('VALIDATION_FAILED', `Invalid pricing input: ${what}`);
};

const assertNonNegInt = (v: number, what: string): void => {
  if (!Number.isSafeInteger(v) || v < 0) invalid(what);
};

/** Exact floor(a / b) for non-negative safe integers (no float rounding surprises). */
function floorDiv(a: number, b: number): number {
  return (a - (a % b)) / b;
}

/**
 * micro-RON per km = consumption(l/100km) / 100 x price(RON/l)
 * = (consumptionCenti / 100) / 100 x (priceMilli / 1000) x 1e6 = consumptionCenti x priceMilli / 10.
 * 700 x 9810 / 10 = 686_700.
 */
export function ratePerKmMicro(consumptionCenti: number, priceMilli: number): number {
  assertNonNegInt(consumptionCenti, 'consumptionCenti');
  assertNonNegInt(priceMilli, 'priceMilli');
  return floorDiv(consumptionCenti * priceMilli, 10);
}

/** Fuel cost of a segment in micro-RON: floor(segmentM x rateMicro / 1000). At most 4e10: safe. */
export function segmentCostMicro(segmentM: number, rateMicro: number): number {
  assertNonNegInt(segmentM, 'segmentM');
  assertNonNegInt(rateMicro, 'rateMicro');
  return floorDiv(segmentM * rateMicro, 1000);
}

/** Fuel cost of a segment in bani, rounded down (for "you recover about X of Y RON"). */
export function tripCostBani(distanceM: number, rateMicro: number): number {
  return floorDiv(segmentCostMicro(distanceM, rateMicro), MICRO_PER_BANI);
}

/**
 * Price per seat for one passenger's segment when `n` passengers (this one included) are
 * confirmed: segment cost split over n + 1 people (the driver pays a share), rounded DOWN to
 * 0.10 RON. A free ride is always 0.
 */
export function seatPriceBani(
  segmentM: number,
  rateMicro: number,
  n: number,
  isFree: boolean,
): number {
  if (!Number.isSafeInteger(n) || n < 1) invalid('n');
  if (isFree) return 0;
  const cost = segmentCostMicro(segmentM, rateMicro);
  return floorDiv(cost, (n + 1) * STEP_MICRO) * PRICE_STEP_BANI;
}

/** "Up to X RON": the passenger alone with the driver (n = 1). Every later price is at most this. */
export function quoteUpTo(segmentM: number, rateMicro: number, isFree: boolean): number {
  return seatPriceBani(segmentM, rateMicro, 1, isFree);
}

/** A confirmed price can only go down. */
export function relock(oldLockedBani: number, newPriceBani: number): number {
  assertNonNegInt(oldLockedBani, 'oldLockedBani');
  assertNonNegInt(newPriceBani, 'newPriceBani');
  return Math.min(oldLockedBani, newPriceBani);
}

/** Price per seat for the whole route with 1..maxSeats passengers. */
export function priceTable(
  routeM: number,
  rateMicro: number,
  maxSeats: number,
  isFree = false,
): PriceRow[] {
  if (!Number.isSafeInteger(maxSeats) || maxSeats < 1 || maxSeats > MAX_SEATS) invalid('maxSeats');
  const rows: PriceRow[] = [];
  for (let n = 1; n <= maxSeats; n++) {
    rows.push({ passengers: n, priceBani: seatPriceBani(routeM, rateMicro, n, isFree) });
  }
  return rows;
}
