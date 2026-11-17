import { ENERGY_PRICE_LIMITS, type CreateEnergyPriceBody } from '../contracts/admin.ts';
import type { FuelType } from '../contracts/account.ts';
import { DomainError } from './errors.ts';
import { ENERGY_CHANGE_MAX_PCT, ENERGY_PAST_GRACE_MIN, ENERGY_SCHEDULE_MAX_DAYS } from './rules.ts';

/**
 * Energy price versions (E7-4, ADR 0035, e7-metrics-admin-spec §4). Pure rules for adding a row to
 * the append-only, forward-only timeline: ranges, the schedule window, and the 30 % guard. The
 * service supplies the latest row of the fuel (read under an advisory lock) and the clock.
 */

const MIN_MS = 60_000;
const DAY_MS = 86_400_000;

/** Electric is priced per kWh, everything else per litre (the table CHECK requires the same). */
export const unitFor = (fuel: FuelType): 'l' | 'kWh' => (fuel === 'electric' ? 'kWh' : 'l');

/**
 * True when `next` differs from `prev` by MORE than 30 %. Integer math: exactly 30 % passes
 * (`|next - prev| * 100 > 30 * prev`). A missing or non-positive `prev` is never a large change.
 */
export function isLargeChange(prev: number, next: number): boolean {
  if (!Number.isInteger(prev) || !Number.isInteger(next) || prev <= 0) return false;
  return Math.abs(next - prev) * 100 > ENERGY_CHANGE_MAX_PCT * prev;
}

/** The latest row of the fuel (by `effective_from`), whether in force or scheduled. */
export type LatestEnergyPrice = {
  priceMilli: number;
  consumptionCenti: number;
  effectiveFrom: Date;
};

export type EnergyPriceDecision = {
  effectiveFrom: Date;
  unit: 'l' | 'kWh';
  /** True when the 30 % guard fired and was overridden (goes into the audit row). */
  override: boolean;
};

const bad = (message: string, fields: Record<string, string>) =>
  new DomainError('VALIDATION_FAILED', message, fields);

/** Truncates to the minute. */
export const truncateToMinute = (at: Date): Date =>
  new Date(Math.floor(at.getTime() / MIN_MS) * MIN_MS);

/**
 * Checks a new energy price in the spec's order and returns the resolved `effectiveFrom`:
 * 1. integer ranges (`priceMilli` 100..50 000, `consumptionCenti` 100..5 000) and the source note
 *    (1..200 characters after trimming), all `400 VALIDATION_FAILED`;
 * 2. `effectiveFrom`: valid, default now, truncated to the minute, not older than 5 minutes, not more
 *    than 30 days ahead (`past` / `too_far`), later than the latest row (`not_after_latest`), `400`;
 * 3. the 30 % guard on price or consumption: `409 LARGE_CHANGE` unless `overrideLargeChange` is true.
 */
export function decideEnergyPrice(
  body: CreateEnergyPriceBody,
  now: Date,
  latest: LatestEnergyPrice | null,
): EnergyPriceDecision {
  const { priceMilli: pr, consumptionCenti: cr, sourceNoteMax } = ENERGY_PRICE_LIMITS;
  const fields: Record<string, string> = {};
  if (!Number.isInteger(body.priceMilli) || body.priceMilli < pr.min || body.priceMilli > pr.max) {
    fields.priceMilli = 'out_of_range';
  }
  if (
    !Number.isInteger(body.consumptionCenti) ||
    body.consumptionCenti < cr.min ||
    body.consumptionCenti > cr.max
  ) {
    fields.consumptionCenti = 'out_of_range';
  }
  const note = body.sourceNote.normalize('NFC').trim();
  if (note === '') fields.sourceNote = 'required';
  else if ([...note].length > sourceNoteMax) fields.sourceNote = 'too_long';
  if (Object.keys(fields).length > 0) throw bad('Check the energy price values.', fields);

  let effectiveFrom = truncateToMinute(now);
  if (body.effectiveFrom !== undefined) {
    const parsed = new Date(body.effectiveFrom);
    if (Number.isNaN(parsed.getTime())) {
      throw bad('Invalid date.', { effectiveFrom: 'invalid' });
    }
    effectiveFrom = truncateToMinute(parsed);
  }
  if (effectiveFrom.getTime() < now.getTime() - ENERGY_PAST_GRACE_MIN * MIN_MS) {
    throw bad('The date is in the past.', { effectiveFrom: 'past' });
  }
  if (effectiveFrom.getTime() > now.getTime() + ENERGY_SCHEDULE_MAX_DAYS * DAY_MS) {
    throw bad('The date is too far ahead.', { effectiveFrom: 'too_far' });
  }
  if (latest && effectiveFrom.getTime() <= latest.effectiveFrom.getTime()) {
    throw bad('The date must be later than the latest price.', {
      effectiveFrom: 'not_after_latest',
    });
  }

  let override = false;
  if (latest) {
    const large: Record<string, string> = {};
    if (isLargeChange(latest.priceMilli, body.priceMilli)) large.priceMilli = 'large_change';
    if (isLargeChange(latest.consumptionCenti, body.consumptionCenti)) {
      large.consumptionCenti = 'large_change';
    }
    if (Object.keys(large).length > 0) {
      if (body.overrideLargeChange !== true) {
        throw new DomainError(
          'LARGE_CHANGE',
          `This is more than a ${ENERGY_CHANGE_MAX_PCT}% change. Confirm it is correct.`,
          large,
        );
      }
      override = true;
    }
  }
  return { effectiveFrom, unit: unitFor(body.fuelType), override };
}
