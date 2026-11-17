import type { Db } from '../../_shared/db.ts';
import type { FuelType } from '../../_shared/contracts/account.ts';

/**
 * SQL for energy price versions (E7-4, ADR 0035). The table is append-only for the API role (UPDATE and
 * DELETE are revoked). One transaction takes the advisory lock, reads the latest row of the fuel,
 * inserts, and writes the audit row.
 */

type Ts = Date | string;

export type EnergyPriceRow = {
  id: string;
  fuel_type: FuelType;
  price_milli: number;
  consumption_centi: number;
  unit: 'l' | 'kWh';
  effective_from: Ts;
  source_note: string | null;
  created_by: string | null;
  created_by_first_name: string | null;
  created_at: Ts;
};

/** Serialises every price insert: the forward-only check is then race-free. Released at commit. */
export async function lockEnergyPrices(sql: Db): Promise<void> {
  await sql`select pg_advisory_xact_lock(hashtext('app.energy_prices'))`;
}

/** The latest row of a fuel by `effective_from`, whether in force or scheduled. */
export async function selectLatestForFuel(
  sql: Db,
  fuel: FuelType,
): Promise<{ price_milli: number; consumption_centi: number; effective_from: Ts } | undefined> {
  const rows = await sql<{ price_milli: number; consumption_centi: number; effective_from: Ts }[]>`
    select price_milli, consumption_centi, effective_from
    from app.energy_prices
    where fuel_type = ${fuel}::app.fuel_type
    order by effective_from desc
    limit 1`;
  return rows[0];
}

export async function insertEnergyPrice(
  sql: Db,
  v: {
    fuel: FuelType;
    priceMilli: number;
    consumptionCenti: number;
    unit: 'l' | 'kWh';
    effectiveFrom: Date;
    sourceNote: string;
    adminId: string;
    now: Date;
  },
): Promise<string> {
  const rows = await sql<{ id: string }[]>`
    insert into app.energy_prices
      (fuel_type, price_milli, consumption_centi, unit, effective_from, source_note, created_by, created_at)
    values (${v.fuel}::app.fuel_type, ${v.priceMilli}::integer, ${v.consumptionCenti}::integer,
            ${v.unit}::text, ${v.effectiveFrom}::timestamptz, ${v.sourceNote}::text,
            ${v.adminId}::uuid, ${v.now}::timestamptz)
    returning id`;
  const row = rows[0];
  if (!row) throw new Error('energy price insert returned no row');
  return row.id;
}

/** The audit row. `details` holds numbers, the fuel and a boolean: no free text beyond the price note kept in the price row. */
export async function insertEnergyAudit(
  sql: Db,
  adminId: string,
  details: Record<string, string | number | boolean | null>,
): Promise<void> {
  await sql`
    insert into app.admin_actions (admin_id, action, target_user_id, report_id, details)
    values (${adminId}::uuid, 'energy_price_added', null, null, ${JSON.stringify(details)}::text::jsonb)`;
}

/** One row by id with the creator's first name. */
export async function selectEnergyPrice(sql: Db, id: string): Promise<EnergyPriceRow | undefined> {
  const rows = await sql<EnergyPriceRow[]>`
    select e.id, e.fuel_type, e.price_milli, e.consumption_centi, e.unit, e.effective_from,
           e.source_note, e.created_by, p.first_name as created_by_first_name, e.created_at
    from app.energy_prices e
    left join app.profiles p on p.id = e.created_by
    where e.id = ${id}`;
  return rows[0];
}

/** Every version, newest `effective_from` first (the table holds a handful of rows per fuel). */
export async function selectAllEnergyPrices(sql: Db, limit: number): Promise<EnergyPriceRow[]> {
  return await sql<EnergyPriceRow[]>`
    select e.id, e.fuel_type, e.price_milli, e.consumption_centi, e.unit, e.effective_from,
           e.source_note, e.created_by, p.first_name as created_by_first_name, e.created_at
    from app.energy_prices e
    left join app.profiles p on p.id = e.created_by
    order by e.effective_from desc, e.id
    limit ${limit}`;
}
