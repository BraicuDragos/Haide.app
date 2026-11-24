import type { Db } from '../../_shared/db.ts';
import type { Place } from '../../_shared/contracts/geo.ts';
import {
  approximatePlaceId,
  buildAddressLabel,
  estimatePosition,
  hasExactNumber,
  normalizeForMatch,
  parseAddressQuery,
  type ParsedAddress,
} from '../../_shared/domain/address.ts';
import { inCoverage } from '../../_shared/domain/privacy.ts';
import { areaNameForPoint, findStreetCandidates, searchPlaces, toPlace } from '../repo/places.ts';

/** A street key shorter than this (letters only) is too vague to place a number on. */
const MIN_STREET_LETTERS = 3;

/**
 * Synthetic suggestions for "street + number" queries whose number the gazetteer lacks (ADR 0042).
 * At most one per locality (2 localities), each only when no known address of that street already
 * has exactly this number and suffix, and only when some data of the street exists (a known
 * number or the street's own point): a position is never invented.
 */
export async function approximateAddresses(sql: Db, parsed: ParsedAddress): Promise<Place[]> {
  const num = parsed.number;
  if (!num || parsed.streetKey.replace(/[^a-z]/g, '').length < MIN_STREET_LETTERS) return [];

  const out: Place[] = [];
  for (const c of await findStreetCandidates(sql, parsed.streetKey)) {
    if (hasExactNumber(c.known, num)) continue;
    const pos = estimatePosition(c.known, num.n, c.streetPoint);
    if (!pos) continue;
    const point = { lat: pos.lat, lng: pos.lng };
    if (!inCoverage(point)) continue; // never offer a point the app cannot search or publish
    const area = await areaNameForPoint(sql, point);
    const place = toPlace({
      id: approximatePlaceId(c.locality, c.name, num),
      name: buildAddressLabel(c.name, num, parsed.extras),
      kind: 'address',
      locality: c.locality || null,
      area_name: area,
      lat: point.lat,
      lng: point.lng,
    });
    out.push({ ...place, approximate: true });
  }
  return out;
}

/**
 * GET /places: the normal gazetteer search, with synthetic approximate addresses first when the
 * query carries a house number. Non-number queries run exactly the existing SQL, nothing more.
 */
export async function searchPlacesWithAddresses(
  sql: Db,
  q: string,
  limit: number,
): Promise<Place[]> {
  const parsed = parseAddressQuery(q);
  if (!parsed.number) return await searchPlaces(sql, q, limit);

  const [synthetic, normal] = await Promise.all([
    approximateAddresses(sql, parsed),
    searchPlaces(sql, q, limit),
  ]);
  // Never show the same address twice (same label in the same locality).
  const seen = new Set(
    normal.map((p) => `${normalizeForMatch(p.name)}|${normalizeForMatch(p.secondary)}`),
  );
  const fresh = synthetic.filter(
    (p) => !seen.has(`${normalizeForMatch(p.name)}|${normalizeForMatch(p.secondary)}`),
  );
  return [...fresh, ...normal].slice(0, limit);
}
