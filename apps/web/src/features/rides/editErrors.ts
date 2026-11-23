import { ApiError } from '@/api/client';
import { t, tError } from '@/i18n';

export type EditField = 'day' | 'time' | 'seats' | 'note';

export interface EditFailure {
  /** The field the message belongs to (and that gets focus); no field means a banner above the buttons. */
  field?: EditField;
  message: string;
  /** The ride changed under us (gone, departed, cancelled): refetch it. */
  refetch?: boolean;
}

/** Every 400/409 code of PATCH /rides/{id} (ADR 0041), plus offline, mapped to a place and a message. */
export function classifyEditError(err: unknown, ctx: { maxSeats: number }): EditFailure {
  const code = err instanceof ApiError ? err.code : 'NETWORK';
  const fields = err instanceof ApiError ? err.fields : undefined;
  switch (code) {
    case 'DEPARTURE_TOO_SOON':
    case 'DEPARTURE_TOO_FAR':
      return { field: 'time', message: tError(code) };
    case 'DAILY_RIDE_LIMIT':
      return { field: 'day', message: tError(code) };
    case 'SEATS_BELOW_BOOKED':
      return { field: 'seats', message: tError(code) };
    case 'SEATS_EXCEED_VEHICLE':
      return { field: 'seats', message: t('offer.err.seats', { n: ctx.maxSeats }) };
    case 'RIDE_NOT_EDITABLE':
    case 'NOT_FOUND':
      return { message: tError(code), refetch: true };
    case 'VALIDATION_FAILED':
      if (fields?.departureAt) return { field: 'time', message: t('offer.err.time') };
      if (fields?.seats)
        return { field: 'seats', message: t('offer.err.seats', { n: ctx.maxSeats }) };
      if (fields?.note) return { field: 'note', message: t('offer.note.hint', { n: 200 }) };
      return { message: tError(code) };
    default:
      return { message: tError(code) };
  }
}
