import type { ShareLinkResponse, SharedTrip } from '../../_shared/contracts/safety.ts';
import { sharePhase, shareExpiresAt } from '../../_shared/domain/safety.ts';
import { AppError } from '../../_shared/errors.ts';
import { hashShareToken, newShareToken, SHARE_TOKEN_RE } from '../../_shared/shareToken.ts';
import { lockRideOfBookingForPassenger, selectBookingState } from '../repo/bookings.ts';
import { deleteShareLink, selectSharedTrip, upsertShareLink } from '../repo/shareLinks.ts';
import { parseLineString } from '../serializers/rides.ts';
import { toSharedTripResponse } from '../serializers/share.ts';
import { pickupEta } from '../serializers/bookings.ts';
import type { Account, Deps } from '../types.ts';
import { asBookingId, tx } from './bookings.ts';
import { avatarUrl } from './storage.ts';

/**
 * Share-trip link (E5-6, ADR 0026). Passenger only (a driver gets 404). One live link per booking:
 * creating again rotates it. Only the SHA-256 of the 128-bit token is stored.
 */

const bookingNotFound = () => new AppError('NOT_FOUND', 'Booking not found.');
const toHex = (b: Uint8Array): string =>
  [...b].map((x) => x.toString(16).padStart(2, '0')).join('');

export async function createShareLink(
  deps: Deps,
  account: Account,
  id: string,
): Promise<ShareLinkResponse> {
  const bookingId = asBookingId(id);
  const { clock, env } = deps;
  const now = clock.now();

  return await tx(deps, async (db) => {
    const ride = await lockRideOfBookingForPassenger(db, bookingId, account.id);
    if (!ride) throw bookingNotFound(); // unknown, or the caller is the driver
    const state = await selectBookingState(db, bookingId);
    if (!state) throw bookingNotFound();
    if (
      (state.status !== 'confirmed' && state.status !== 'completed') ||
      ride.status === 'cancelled'
    ) {
      throw new AppError('INVALID_STATE', 'A link can only be shared for a confirmed ride.');
    }
    const expiresAt = shareExpiresAt(new Date(ride.departure_at));
    if (now.getTime() >= expiresAt.getTime()) {
      throw new AppError('WINDOW_CLOSED', 'The time to share this ride has passed.');
    }
    const token = newShareToken();
    await upsertShareLink(db, {
      bookingId,
      tokenHashHex: toHex(await hashShareToken(token)),
      createdBy: account.id,
      expiresAt,
      now,
    });
    return {
      url: `${env.APP_BASE_URL.replace(/\/+$/, '')}/s/${token}`,
      expiresAt: expiresAt.toISOString(),
    };
  });
}

/** Revokes the link. Idempotent (204 also when there is none); 404 unless the caller is the passenger. */
export async function revokeShareLink(deps: Deps, account: Account, id: string): Promise<void> {
  const bookingId = asBookingId(id);
  const state = await selectBookingState(deps.sql, bookingId);
  if (!state || state.passenger_id !== account.id) throw bookingNotFound();
  await deleteShareLink(deps.sql, bookingId);
}

/**
 * GET /share/{token}, public. A malformed token is a 404 without a database call. Anything that is
 * not a live link (unknown, expired, revoked, booking cancelled, a party suspended) is the same 404.
 * Never a phone, the passenger's name, the driver's origin or destination, or another booking.
 */
export async function getSharedTrip(deps: Deps, token: string): Promise<SharedTrip> {
  const gone = () => new AppError('NOT_FOUND', 'Not found.');
  if (!SHARE_TOKEN_RE.test(token)) throw gone();
  const now = deps.clock.now();
  const row = await selectSharedTrip(deps.sql, toHex(await hashShareToken(token)), now);
  if (!row) throw gone();
  const departureAt = new Date(row.departure_at);
  return toSharedTripResponse({
    departureAt: departureAt.toISOString(),
    pickupEtaAt: pickupEta(departureAt, row.duration_s, row.pickup_fraction).toISOString(),
    phase: sharePhase({ departureAt, status: row.status }, deps.clock),
    expiresAt: new Date(row.expires_at).toISOString(),
    driver: {
      firstName: row.driver_first_name,
      photoUrl: avatarUrl(deps.env, row.driver_photo_path),
    },
    car: {
      make: row.car_make ?? '',
      model: row.car_model ?? '',
      colour: row.car_colour ?? '',
      plate: row.car_plate ?? '',
    },
    pickup: { label: row.pickup_label },
    dropoff: { label: row.dropoff_label },
    route: parseLineString(row.segment_geojson),
  });
}
