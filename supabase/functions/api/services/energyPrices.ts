import type {
  CreateEnergyPriceBody,
  CreateEnergyPriceResponse,
  EnergyPricesResponse,
} from '../../_shared/contracts/admin.ts';
import type { FuelType } from '../../_shared/contracts/account.ts';
import { decideEnergyPrice } from '../../_shared/domain/energyPrices.ts';
import {
  insertEnergyAudit,
  insertEnergyPrice,
  lockEnergyPrices,
  selectAllEnergyPrices,
  selectEnergyPrice,
  selectLatestForFuel,
  type EnergyPriceRow,
} from '../repo/energyPrices.ts';
import { toEnergyPrice } from '../serializers/admin.ts';
import type { Account, Deps } from '../types.ts';
import { tx } from './bookings.ts';

/**
 * Energy price versions (E7-4, ADR 0035, e7-metrics-admin-spec §4). Append-only and forward-only:
 * one transaction holds an advisory lock, reads the latest row of the fuel, applies the pure rules
 * (domain/energyPrices.ts), inserts, and writes the `energy_price_added` audit row. Published rides
 * keep their snapshot, and `energyPriceFor()` picks the row in force at publish time, so a scheduled
 * row needs no job.
 */

const FUEL_ORDER: readonly FuelType[] = ['petrol', 'diesel', 'lpg', 'hybrid', 'electric'];
const ROWS_MAX = 1000;
const HISTORY_ROWS = 50;

const at = (v: Date | string): number => new Date(v).getTime();

export async function listEnergyPrices(deps: Deps): Promise<EnergyPricesResponse> {
  const now = deps.clock.now().getTime();
  const rows = await selectAllEnergyPrices(deps.sql, ROWS_MAX); // newest effective_from first

  const fuels: EnergyPricesResponse['fuels'] = [];
  for (const fuel of FUEL_ORDER) {
    const mine = rows.filter((r) => r.fuel_type === fuel);
    if (mine.length === 0) continue;
    // In force: the newest row that has started. Before the first start, the earliest row (as energyPriceFor).
    const current: EnergyPriceRow =
      mine.find((r) => at(r.effective_from) <= now) ?? mine[mine.length - 1]!;
    const upcoming = mine.filter((r) => at(r.effective_from) > now);
    const scheduled = upcoming[upcoming.length - 1] ?? null; // the soonest one
    fuels.push({
      fuelType: fuel,
      unit: current.unit,
      current: toEnergyPrice(current),
      scheduled: scheduled ? toEnergyPrice(scheduled) : null,
    });
  }
  return { fuels, history: rows.slice(0, HISTORY_ROWS).map(toEnergyPrice) };
}

export async function createEnergyPrice(
  deps: Deps,
  admin: Account,
  body: CreateEnergyPriceBody,
): Promise<CreateEnergyPriceResponse> {
  const now = deps.clock.now();
  return await tx(deps, async (db) => {
    await lockEnergyPrices(db);
    const latestRow = await selectLatestForFuel(db, body.fuelType);
    const latest = latestRow
      ? {
          priceMilli: latestRow.price_milli,
          consumptionCenti: latestRow.consumption_centi,
          effectiveFrom: new Date(latestRow.effective_from),
        }
      : null;
    const decision = decideEnergyPrice(body, now, latest);

    const id = await insertEnergyPrice(db, {
      fuel: body.fuelType,
      priceMilli: body.priceMilli,
      consumptionCenti: body.consumptionCenti,
      unit: decision.unit,
      effectiveFrom: decision.effectiveFrom,
      sourceNote: body.sourceNote.normalize('NFC').trim(),
      adminId: admin.id,
      now,
    });
    await insertEnergyAudit(db, admin.id, {
      energyPriceId: id,
      fuelType: body.fuelType,
      priceMilli: body.priceMilli,
      prevPriceMilli: latest?.priceMilli ?? null,
      consumptionCenti: body.consumptionCenti,
      prevConsumptionCenti: latest?.consumptionCenti ?? null,
      effectiveFrom: decision.effectiveFrom.toISOString(),
      override: decision.override,
    });
    const row = await selectEnergyPrice(db, id);
    if (!row) throw new Error('energy price vanished after insert');
    return { item: toEnergyPrice(row) };
  });
}
