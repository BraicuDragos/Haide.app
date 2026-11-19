import type { PublicUser } from '../../_shared/contracts/account.ts';
import type { BookingListItem, BookingView } from '../../_shared/contracts/bookings.ts';
import type { RatingGiven } from '../../_shared/contracts/ratings.ts';
import type {
  ExactOrApproxPoint,
  RidePassengerItem,
  RideRequestItem,
} from '../../_shared/contracts/rides.ts';
import {
  bookingActions,
  bookingPrice,
  buildTimeline,
  priceIfAcceptedBani,
  revealedUntil,
  revealFor,
} from '../../_shared/domain/bookings.ts';
import type { Clock } from '../../_shared/domain/clock.ts';
import { canRateNow, rateUntil } from '../../_shared/domain/ratings.ts';
import { canMarkNoShow } from '../../_shared/domain/safety.ts';
import { roundCoord, roundWalkM } from '../../_shared/domain/privacy.ts';
import { roundEta } from '../../_shared/domain/search.ts';
import type { BookingListRow, BookingViewRow, PassengerRow, RequestRow } from '../repo/bookings.ts';
import { parseLineString } from './rides.ts';

/**
 * Role-based shaping of bookings (data-model 5.2, ADR 0023). Every exact point, phone and plate
 * leaves through revealFor(): confirmed or completed and before departure + 24 h. Everything else
 * gets the 300 m grid centre, `null` contact and `null` plate. Labels are area names.
 */

const iso = (d: Date | string): string => new Date(d).toISOString();

/** A stored rating as the contract shows it, or null when there is none. */
function ratingGiven(
  stars: number | null,
  tags: string[] | null,
  createdAt: Date | string | null,
): RatingGiven | null {
  if (stars === null || createdAt === null) return null;
  return { stars, tags: (tags ?? []) as RatingGiven['tags'], createdAt: iso(createdAt) };
}

/** When the driver passes the pickup, rounded to 5 minutes (ADR 0005). */
export function pickupEta(departureAt: Date | string, durationS: number, fraction: number): Date {
  return roundEta(new Date(new Date(departureAt).getTime() + durationS * fraction * 1000));
}

function bookingPoint(
  revealed: boolean,
  exact: { lat: number; lng: number },
  grid: { lat: number; lng: number },
): ExactOrApproxPoint {
  if (revealed) return { lat: roundCoord(exact.lat), lng: roundCoord(exact.lng) };
  return {
    lat: roundCoord(grid.lat),
    lng: roundCoord(grid.lng),
    approx: true as const,
    radiusM: 300 as const,
  };
}

export function toBookingView(
  row: BookingViewRow,
  viewerId: string,
  profiles: { driver: PublicUser; passenger: PublicUser },
  clock: Clock,
): BookingView {
  const departureAt = new Date(row.departure_at);
  const viewerIsPassenger = viewerId === row.passenger_id;
  const revealed = revealFor({ status: row.status, departureAt }, clock);

  const phone = viewerIsPassenger ? row.driver_phone : row.passenger_phone;
  const completedAt = row.completed_at ? new Date(row.completed_at) : null;
  // Only the viewer's own rating is ever shown, never whether the counterpart rated.
  const given = viewerIsPassenger
    ? ratingGiven(row.rp_stars, row.rp_tags, row.rp_created_at)
    : ratingGiven(row.rd_stars, row.rd_tags, row.rd_created_at);
  const anyRated = row.rp_stars !== null || row.rd_stars !== null;
  const shareExpiry = row.share_expires_at ? new Date(row.share_expires_at) : null;
  const shareActive = shareExpiry !== null && shareExpiry.getTime() > clock.now().getTime();

  return {
    id: row.id,
    status: row.status,
    autoConfirmed: row.auto_confirmed === true,
    rideId: row.ride_id,
    rideStatus: row.ride_status,
    viewerRole: viewerIsPassenger ? 'passenger' : 'driver',
    departureAt: departureAt.toISOString(),
    pickupEtaAt: pickupEta(departureAt, row.duration_s, row.pickup_fraction).toISOString(),
    requestedAt: iso(row.requested_at),
    expiresAt: iso(row.expires_at),
    decidedAt: row.decided_at ? iso(row.decided_at) : null,
    cancelledAt: row.cancelled_at ? iso(row.cancelled_at) : null,
    cancelledBy: row.cancelled_by,
    pickup: {
      point: bookingPoint(
        revealed,
        { lat: row.pickup_lat, lng: row.pickup_lng },
        { lat: row.pickup_grid_lat, lng: row.pickup_grid_lng },
      ),
      label: row.pickup_label,
      walkM: roundWalkM(row.walk_pickup_m),
    },
    dropoff: {
      point: bookingPoint(
        revealed,
        { lat: row.dropoff_lat, lng: row.dropoff_lng },
        { lat: row.dropoff_grid_lat, lng: row.dropoff_grid_lng },
      ),
      label: row.dropoff_label,
      walkM: roundWalkM(row.walk_dropoff_m),
    },
    segmentM: row.segment_m,
    // Revealed: the passenger's own exact segment only (never the driver's start and end).
    route: revealed ? parseLineString(row.segment_geojson) : parseLineString(row.route_public),
    price: bookingPrice(
      {
        status: row.status,
        departureAt,
        quotedBani: row.price_quoted_bani,
        lockedBani: row.price_locked_bani,
        finalBani: row.final_price_bani,
      },
      clock,
    ),
    driver: profiles.driver,
    passenger: profiles.passenger,
    car: {
      make: row.car_make ?? '',
      model: row.car_model ?? '',
      colour: row.car_colour ?? '',
      // The driver owns the plate; a passenger gets it only through the reveal window.
      plate: revealed || !viewerIsPassenger ? row.car_plate : null,
    },
    contact:
      revealed && phone
        ? { phoneE164: phone, revealedUntil: revealedUntil(departureAt).toISOString() }
        : null,
    timeline: buildTimeline({
      status: row.status,
      requestedAt: new Date(row.requested_at),
      expiresAt: new Date(row.expires_at),
      decidedAt: row.decided_at ? new Date(row.decided_at) : null,
      cancelledAt: row.cancelled_at ? new Date(row.cancelled_at) : null,
      cancelledBy: row.cancelled_by,
      rideStatus: row.ride_status,
      completedAt,
      noShowAt: row.no_show_at ? new Date(row.no_show_at) : null,
    }),
    unseen: viewerIsPassenger ? row.unseen : false,
    actions: bookingActions(
      {
        status: row.status,
        departureAt,
        viewerIsPassenger,
        rideStatus: row.ride_status,
        completedAt,
        viewerRated: given !== null,
        anyRated,
      },
      clock,
    ),
    completedAt: completedAt ? completedAt.toISOString() : null,
    noShowBy: row.no_show_by,
    rating: {
      given,
      rateUntil:
        row.status === 'completed' && completedAt ? rateUntil(completedAt).toISOString() : null,
    },
    share: viewerIsPassenger
      ? {
          active: shareActive,
          expiresAt: shareActive && shareExpiry ? shareExpiry.toISOString() : null,
        }
      : null,
  };
}

export function toBookingListItem(
  row: BookingListRow,
  driver: PublicUser,
  clock: Clock,
): BookingListItem {
  const departureAt = new Date(row.departure_at);
  const price = bookingPrice(
    {
      status: row.status,
      departureAt,
      quotedBani: row.price_quoted_bani,
      lockedBani: row.price_locked_bani,
      finalBani: row.final_price_bani,
    },
    clock,
  );
  return {
    id: row.id,
    rideId: row.ride_id,
    status: row.status,
    rideStatus: row.ride_status,
    departureAt: departureAt.toISOString(),
    pickupEtaAt: pickupEta(departureAt, row.duration_s, row.pickup_fraction).toISOString(),
    pickupLabel: row.pickup_label,
    dropoffLabel: row.dropoff_label,
    driver,
    priceBani: price.finalBani ?? price.lockedBani ?? price.quotedBani,
    unseen: row.unseen,
    cancelledBy: row.cancelled_by,
    canRate: canRateNow(
      {
        status: row.status,
        completedAt: row.completed_at ? new Date(row.completed_at) : null,
        alreadyRated: row.rated,
      },
      clock,
    ),
  };
}

// ---- owner ride view: requests and passengers ------------------------------------------------------------

/** An open request as the driver sees it: public profile, area labels, price, deadline. Never a point. */
export function toRequestItem(
  row: RequestRow,
  passenger: PublicUser,
  ride: { rateMicroPerKm: number; isFree: boolean; confirmedCount: number },
): RideRequestItem {
  return {
    bookingId: row.id,
    passenger,
    pickupLabel: row.pickup_label,
    dropoffLabel: row.dropoff_label,
    segmentM: row.segment_m,
    priceIfAcceptedBani: priceIfAcceptedBani(
      row.segment_m,
      ride.rateMicroPerKm,
      ride.confirmedCount,
      ride.isFree,
    ),
    requestedAt: iso(row.requested_at),
    expiresAt: iso(row.expires_at),
  };
}

export function toPassengerItem(
  row: PassengerRow,
  passenger: PublicUser,
  ride: { departureAt: Date; completedAt: Date | null },
  clock: Clock,
): RidePassengerItem {
  const { departureAt, completedAt } = ride;
  const revealed = revealFor({ status: row.status, departureAt }, clock);
  const given = ratingGiven(row.rating_stars, row.rating_tags, row.rating_created_at);
  const price = bookingPrice(
    {
      status: row.status,
      departureAt,
      quotedBani: row.price_locked_bani ?? 0,
      lockedBani: row.price_locked_bani,
      finalBani: row.final_price_bani,
    },
    clock,
  );
  return {
    bookingId: row.id,
    status: row.status,
    passenger,
    pickup: {
      point: bookingPoint(
        revealed,
        { lat: row.pickup_lat, lng: row.pickup_lng },
        { lat: row.pickup_grid_lat, lng: row.pickup_grid_lng },
      ),
      label: row.pickup_label,
    },
    dropoff: {
      point: bookingPoint(
        revealed,
        { lat: row.dropoff_lat, lng: row.dropoff_lng },
        { lat: row.dropoff_grid_lat, lng: row.dropoff_grid_lng },
      ),
      label: row.dropoff_label,
    },
    phoneE164: revealed ? row.phone_e164 : null,
    priceLockedBani: row.price_locked_bani,
    finalPriceBani: price.finalBani,
    noShowBy: row.no_show_by,
    canMarkNoShow: canMarkNoShow(
      { status: row.status, departureAt, hasRating: row.any_rated },
      clock,
    ),
    canRate: canRateNow({ status: row.status, completedAt, alreadyRated: given !== null }, clock),
    rateUntil:
      row.status === 'completed' && completedAt ? rateUntil(completedAt).toISOString() : null,
    ratingGiven: given,
  };
}
