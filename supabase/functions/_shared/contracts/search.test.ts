import { describe, expect, it } from 'vitest';
import {
  SEARCH_LIMITS,
  matchBodySchema,
  matchResponseSchema,
  notBookableReasonSchema,
  searchBodySchema,
  searchItemSchema,
  searchResponseSchema,
} from './search.ts';

const FROM = { lat: 45.7413, lng: 24.1861 };
const TO = { lat: 45.785, lng: 24.09 };
const RIDE_ID = 'a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d';

const place = (lat = 45.7413, lng = 24.1861) => ({
  point: { lat, lng, approx: true as const, radiusM: 300 as const },
  label: 'Șelimbăr',
  walkM: 150,
});

const item = () => ({
  rideId: RIDE_ID,
  departureAt: '2026-11-16T05:25:00Z',
  pickupEtaAt: '2026-11-16T05:30:00Z',
  pickup: place(),
  dropoff: place(45.785, 24.09),
  segmentM: 9588,
  priceUpToBani: 310,
  isFree: false,
  seatsLeft: 2,
  driver: { id: RIDE_ID, firstName: 'Radu', photoUrl: null, rating: null },
});

describe('search contracts', () => {
  it('request: window defaults to 30 and only 15, 30 and 60 are allowed', () => {
    const base = { from: FROM, to: TO, date: '2026-11-16', time: '07:30' };
    expect(searchBodySchema.parse(base).windowMin).toBe(SEARCH_LIMITS.defaultWindowMin);
    for (const windowMin of SEARCH_LIMITS.windowsMin) {
      expect(searchBodySchema.parse({ ...base, windowMin }).windowMin).toBe(windowMin);
    }
    expect(searchBodySchema.safeParse({ ...base, windowMin: 45 }).success).toBe(false);
  });

  it('request: strict date and time formats, no price field survives', () => {
    const base = { from: FROM, to: TO, date: '2026-11-16', time: '07:30' };
    expect(searchBodySchema.safeParse({ ...base, date: '16-11-2026' }).success).toBe(false);
    expect(searchBodySchema.safeParse({ ...base, time: '7:30' }).success).toBe(false);
    expect(searchBodySchema.safeParse({ ...base, time: '24:00' }).success).toBe(false);
    expect(searchBodySchema.safeParse({ ...base, from: { lat: 91, lng: 0 } }).success).toBe(false);
    expect(searchBodySchema.parse({ ...base, priceBani: 1 })).not.toHaveProperty('priceBani');
  });

  it('response: items, nearestOutsideWindow and hiddenBlockedCount', () => {
    const ok = searchResponseSchema.parse({
      items: [item()],
      nearestOutsideWindow: [],
      hiddenBlockedCount: 0,
    });
    expect(ok.items[0]?.pickup.point.approx).toBe(true);
    expect(searchResponseSchema.safeParse({ items: [] }).success).toBe(false);
  });

  it('a result can only carry approximate points', () => {
    const exact = { ...item(), pickup: { ...place(), point: { lat: 45.74, lng: 24.18 } } };
    expect(searchItemSchema.safeParse(exact).success).toBe(false);
    const wrongRadius = {
      ...item(),
      pickup: { ...place(), point: { lat: 45.74, lng: 24.18, approx: true, radiusM: 50 } },
    };
    expect(searchItemSchema.safeParse(wrongRadius).success).toBe(false);
  });

  it('a result card has no plate, phone or bio: the driver is a slice of PublicUser', () => {
    const out = searchItemSchema.parse({
      ...item(),
      driver: { ...item().driver, bio: 'x', phoneE164: '+40721234567', plate: 'SB12ABC' },
    });
    expect(Object.keys(out.driver).sort()).toEqual(['firstName', 'id', 'photoUrl', 'rating']);
  });

  it('match: body and response, nullable places when the points no longer fit', () => {
    expect(matchBodySchema.safeParse({ from: FROM, to: TO }).success).toBe(true);
    expect(matchBodySchema.safeParse({ from: FROM }).success).toBe(false);
    const full = {
      pickup: place(),
      dropoff: place(45.785, 24.09),
      segmentM: 5390,
      priceUpToBani: 120,
      pickupEtaAt: '2026-11-16T05:30:00Z',
      seatsLeft: 2,
      bookable: true,
      notBookableReason: null,
    };
    expect(matchResponseSchema.parse(full).bookable).toBe(true);
    const noMatch = {
      pickup: null,
      dropoff: null,
      segmentM: null,
      priceUpToBani: null,
      pickupEtaAt: null,
      seatsLeft: 2,
      bookable: false,
      notBookableReason: 'NO_LONGER_MATCHES',
    };
    expect(matchResponseSchema.parse(noMatch).notBookableReason).toBe('NO_LONGER_MATCHES');
    expect(matchResponseSchema.safeParse({ ...noMatch, notBookableReason: 'NOPE' }).success).toBe(
      false,
    );
  });

  it('disabled-button reasons are the api-contract set', () => {
    expect(notBookableReasonSchema.options).toEqual([
      'RIDE_FULL',
      'RIDE_NOT_BOOKABLE',
      'OWN_RIDE',
      'BLOCKED',
      'ALREADY_REQUESTED',
      'NO_LONGER_MATCHES',
    ]);
  });
});
