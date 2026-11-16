import type { PublicUser } from '../../_shared/contracts/account.ts';
import type { MatchResponse, SearchItem, SearchPlace } from '../../_shared/contracts/search.ts';
import { quoteUpTo } from '../../_shared/domain/pricing.ts';
import { roundCoord, roundWalkM } from '../../_shared/domain/privacy.ts';
import { roundEta } from '../../_shared/domain/search.ts';
import type { MatchRow } from '../repo/search.ts';

/**
 * Public shape of a match (ADR 0005). Fields are picked one by one: exact walk distances, the
 * fractions along the route and the rate snapshot stay behind.
 * Points are already 300 m grid centres (SQL); walks are rounded to 50 m and ETAs to 5 minutes here.
 */

const SIBIU = 'Sibiu';
const iso = (d: Date | string): string => new Date(d).toISOString();

const approx = (lat: number, lng: number) => ({
  lat: roundCoord(lat),
  lng: roundCoord(lng),
  approx: true as const,
  radiusM: 300 as const,
});

export function toPickup(row: MatchRow): SearchPlace {
  return {
    point: approx(row.pickup_lat, row.pickup_lng),
    label: row.pickup_area ?? SIBIU,
    walkM: roundWalkM(row.walk_pickup_m),
  };
}

export function toDropoff(row: MatchRow): SearchPlace {
  return {
    point: approx(row.dropoff_lat, row.dropoff_lng),
    label: row.dropoff_area ?? SIBIU,
    walkM: roundWalkM(row.walk_dropoff_m),
  };
}

/** The price is computed here from the ride's own rate snapshot: the client never sends one. */
export function priceUpToBani(row: MatchRow): number {
  return quoteUpTo(row.segment_m, row.rate_micro_per_km, row.is_free);
}

export function pickupEtaAt(row: MatchRow): string {
  return roundEta(new Date(row.pickup_eta_at)).toISOString();
}

export function toSearchItem(row: MatchRow, driver: PublicUser): SearchItem {
  return {
    rideId: row.ride_id,
    departureAt: iso(row.departure_at),
    pickupEtaAt: pickupEtaAt(row),
    pickup: toPickup(row),
    dropoff: toDropoff(row),
    segmentM: row.segment_m,
    priceUpToBani: priceUpToBani(row),
    isFree: row.is_free,
    seatsLeft: Math.max(1, row.seats_offered - row.seats_booked),
    driver: {
      id: driver.id,
      firstName: driver.firstName,
      photoUrl: driver.photoUrl,
      rating: driver.rating,
    },
  };
}

/** `row` is null when the typed points do not fit the ride any more. */
export function toMatchResponse(
  row: MatchRow | null,
  seatsLeft: number,
  reason: MatchResponse['notBookableReason'],
): MatchResponse {
  return {
    pickup: row ? toPickup(row) : null,
    dropoff: row ? toDropoff(row) : null,
    segmentM: row ? row.segment_m : null,
    priceUpToBani: row ? priceUpToBani(row) : null,
    pickupEtaAt: row ? pickupEtaAt(row) : null,
    seatsLeft,
    bookable: reason === null,
    notBookableReason: reason,
  };
}
