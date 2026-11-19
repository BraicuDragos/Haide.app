import { describe, expect, it } from 'vitest';
import {
  RIDE_LIMITS,
  cancelRideBodySchema,
  createRideBodySchema,
  previewBodySchema,
  priceRowSchema,
  ridesQuerySchema,
} from './rides.ts';

const PREVIEW_ID = 'a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d';

describe('ride request contracts', () => {
  it('preview: points are required, labels optional and trimmed', () => {
    const ok = previewBodySchema.parse({
      origin: { lat: 45.7413, lng: 24.1861 },
      destination: { lat: 45.785, lng: 24.09 },
      originLabel: '  Șelimbăr ',
    });
    expect(ok.originLabel).toBe('Șelimbăr');
    expect(ok.destinationLabel).toBeUndefined();
    expect(previewBodySchema.safeParse({ origin: { lat: 1, lng: 2 } }).success).toBe(false);
    expect(
      previewBodySchema.safeParse({
        origin: { lat: 95, lng: 24 },
        destination: { lat: 45, lng: 24 },
      }).success,
    ).toBe(false);
    expect(
      previewBodySchema.safeParse({
        origin: { lat: 45.7, lng: 24.1 },
        destination: { lat: 45.8, lng: 24.1 },
        originLabel: 'x'.repeat(RIDE_LIMITS.labelMax + 1),
      }).success,
    ).toBe(false);
  });

  it('publish: isFree defaults to false and unknown price fields are dropped', () => {
    const out = createRideBodySchema.parse({
      previewId: PREVIEW_ID,
      departureAt: '2026-11-16T05:30:00Z',
      seats: 3,
      priceBani: 1,
    });
    expect(out).toEqual({
      previewId: PREVIEW_ID,
      departureAt: '2026-11-16T05:30:00Z',
      seats: 3,
      isFree: false,
      autoAccept: false,
    });
  });

  it('publish: rejects seats outside 1..4, non-UTC-looking times and long notes', () => {
    const base = { previewId: PREVIEW_ID, departureAt: '2026-11-16T05:30:00Z', seats: 2 };
    expect(createRideBodySchema.safeParse({ ...base, seats: 0 }).success).toBe(false);
    expect(createRideBodySchema.safeParse({ ...base, seats: 5 }).success).toBe(false);
    expect(
      createRideBodySchema.safeParse({ ...base, departureAt: '16/11/2026 07:30' }).success,
    ).toBe(false);
    expect(createRideBodySchema.safeParse({ ...base, note: 'x'.repeat(201) }).success).toBe(false);
    expect(createRideBodySchema.safeParse({ ...base, note: null }).success).toBe(true);
    expect(
      createRideBodySchema.safeParse({ ...base, departureAt: '2026-11-16T05:30:00.250Z' }).success,
    ).toBe(true);
  });

  it('list query: defaults to upcoming, 20 per page', () => {
    expect(ridesQuerySchema.parse({})).toEqual({ scope: 'upcoming', limit: 20 });
    expect(ridesQuerySchema.parse({ scope: 'past', limit: '5', cursor: 'abc' })).toEqual({
      scope: 'past',
      limit: 5,
      cursor: 'abc',
    });
    expect(ridesQuerySchema.safeParse({ scope: 'all' }).success).toBe(false);
    expect(ridesQuerySchema.safeParse({ limit: '51' }).success).toBe(false);
  });

  it('cancel body is an empty object', () => {
    expect(cancelRideBodySchema.safeParse({}).success).toBe(true);
    expect(cancelRideBodySchema.safeParse({ reason: 'x' }).success).toBe(false);
  });

  it('price rows are whole bani', () => {
    expect(priceRowSchema.safeParse({ passengers: 2, priceBani: 200 }).success).toBe(true);
    expect(priceRowSchema.safeParse({ passengers: 2, priceBani: 2.5 }).success).toBe(false);
    expect(priceRowSchema.safeParse({ passengers: 5, priceBani: 100 }).success).toBe(false);
  });
});
