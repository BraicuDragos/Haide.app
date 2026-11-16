import { ApiError } from '@/api/client';
import { t, tError } from '@/i18n';

/** What the preview endpoint said. `places` means the choice of places is the problem (shown at the fields). */
export interface PreviewFailure {
  message: string;
  places?: string;
}

/** Error codes of POST /rides/preview (api-contract section 4) mapped to copy. Anything else offers Try again. */
export function classifyPreviewError(code: string): PreviewFailure {
  switch (code) {
    case 'SAME_PLACE':
      return { message: t('offer.err.same'), places: t('offer.err.same') };
    case 'ROUTE_TOO_SHORT':
    case 'ROUTE_TOO_LONG':
      return { message: t('offer.err.distance'), places: t('offer.err.distance') };
    case 'ROUTE_NOT_FOUND':
      return { message: t('offer.route.err') };
    case 'ROUTING_UNAVAILABLE':
      return { message: t('errors.ROUTING_UNAVAILABLE') };
    case 'NETWORK':
      return { message: t('offer.route.err') };
    default:
      return { message: tError(code) };
  }
}

export interface PublishFailure {
  /** Field the message belongs to; no field means a banner above the button. */
  field?: 'time' | 'seats' | 'note';
  message: string;
  /** The preview timed out: ask for a fresh one. */
  refreshPreview?: boolean;
  /** The account state changed under us (no car, profile or consent): refresh /me so the gate takes over. */
  refreshAccount?: boolean;
}

/** Every 400/409 (and gate) code of POST /rides, plus the offline case, mapped to a place and a message. */
export function classifyPublishError(
  err: unknown,
  ctx: { seats: number; day: string },
): PublishFailure {
  const code = err instanceof ApiError ? err.code : 'NETWORK';
  const fields = err instanceof ApiError ? err.fields : undefined;
  switch (code) {
    case 'OFFLINE':
      return { message: t('offer.err.offline') };
    case 'DEPARTURE_TOO_SOON':
      return { field: 'time', message: t('offer.err.time') };
    case 'DEPARTURE_TOO_FAR':
      return { field: 'time', message: t('offer.err.timeFar') };
    case 'SEATS_EXCEED_VEHICLE':
      return { field: 'seats', message: t('offer.err.seats', { n: ctx.seats }) };
    case 'DAILY_RIDE_LIMIT':
      return { message: t('offer.err.limit', { day: ctx.day }) };
    case 'PREVIEW_EXPIRED':
      return { message: t('offer.err.expired'), refreshPreview: true };
    case 'VALIDATION_FAILED':
      if (fields?.note) return { field: 'note', message: t('offer.note.hint', { n: 200 }) };
      if (fields?.departureAt) return { field: 'time', message: t('offer.err.time') };
      if (fields?.seats) return { field: 'seats', message: t('offer.err.seats', { n: ctx.seats }) };
      return { message: t('errors.VALIDATION_FAILED') };
    case 'VEHICLE_REQUIRED':
    case 'PROFILE_INCOMPLETE':
    case 'CONSENT_REQUIRED':
      return { message: tError(code), refreshAccount: true };
    default:
      return { message: tError(code) };
  }
}
