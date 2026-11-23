import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { LatLng, Place } from '@/api/types';
import {
  createLookup,
  distanceM,
  inCoverage,
  LABEL_MAX,
  pinId,
  pinLabel,
  pinPlace,
  roundPoint,
  type LabelText,
  type LookupState,
} from './mapPick';

const text: LabelText = {
  near: (n) => `Near ${n}`,
  inArea: (a) => `Pin in ${a}`,
  pinned: 'Pinned location',
};
const pin: LatLng = { lat: 45.797, lng: 24.15 };

function place(over: Partial<Place>): Place {
  return {
    id: 'x',
    name: 'Strada Mare 4',
    secondary: 'Sibiu, Centru',
    kind: 'address',
    point: { lat: 45.797, lng: 24.1501 }, // about 8 m away
    areaName: 'Centru',
    ...over,
  };
}

describe('coverage', () => {
  it('is inclusive on the edges and false outside', () => {
    expect(inCoverage(pin)).toBe(true);
    expect(inCoverage({ lat: 45.68, lng: 23.98 })).toBe(true);
    expect(inCoverage({ lat: 45.86, lng: 24.32 })).toBe(true);
    expect(inCoverage({ lat: 45.8601, lng: 24.15 })).toBe(false);
    expect(inCoverage({ lat: 45.797, lng: 23.9799 })).toBe(false);
    expect(inCoverage({ lat: 46.77, lng: 23.59 })).toBe(false); // Cluj
  });
});

describe('distance and rounding', () => {
  it('haversine is close to known distances', () => {
    expect(distanceM(pin, pin)).toBe(0);
    // 0.001 degree of latitude is about 111 m
    expect(distanceM(pin, { lat: pin.lat + 0.001, lng: pin.lng })).toBeGreaterThan(110);
    expect(distanceM(pin, { lat: pin.lat + 0.001, lng: pin.lng })).toBeLessThan(112);
  });
  it('rounds to 5 decimals and builds the id', () => {
    expect(roundPoint({ lat: 45.7970049, lng: 24.1500051 })).toEqual({
      lat: 45.797,
      lng: 24.15001,
    });
    expect(pinId({ lat: 45.797, lng: 24.15 })).toBe('pin:45.79700,24.15000');
  });
});

describe('pinLabel', () => {
  it('uses the place name when an address is within 60 m', () => {
    expect(pinLabel(pin, place({}), text)).toBe('Strada Mare 4');
  });
  it('uses the name for a close POI and a close street too', () => {
    expect(pinLabel(pin, place({ kind: 'poi', name: 'Piața Mare' }), text)).toBe('Piața Mare');
    expect(pinLabel(pin, place({ kind: 'street', name: 'Strada Mare' }), text)).toBe('Strada Mare');
  });
  it('says "Near ..." when the place is farther than 60 m', () => {
    const far = place({ point: { lat: 45.7976, lng: 24.15 } }); // about 67 m
    expect(distanceM(pin, far.point)).toBeGreaterThan(60);
    expect(pinLabel(pin, far, text)).toBe('Near Strada Mare 4');
  });
  it('treats exactly 60 m as close', () => {
    const p = place({ point: { lat: pin.lat + 60 / 111_195, lng: pin.lng } });
    expect(distanceM(pin, p.point)).toBeLessThanOrEqual(60.1);
    expect(
      pinLabel(pin, place({ point: { lat: pin.lat + 59 / 111_195, lng: pin.lng } }), text),
    ).toBe('Strada Mare 4');
  });
  it('says "Pin in <area>" for an area result, even close by', () => {
    expect(
      pinLabel(pin, place({ kind: 'area', name: 'Terezian', areaName: 'Terezian' }), text),
    ).toBe('Pin in Terezian');
  });
  it('falls back to the area name, then to "Pinned location"', () => {
    expect(pinLabel(pin, place({ name: '  ', areaName: 'Centru' }), text)).toBe('Pin in Centru');
    expect(pinLabel(pin, null, text)).toBe('Pinned location');
    expect(pinLabel(pin, place({ name: '', areaName: '' }), text)).toBe('Pinned location');
  });
  it('never exceeds 80 characters and keeps the prefix', () => {
    const long = 'A'.repeat(200);
    expect([...pinLabel(pin, place({ name: long }), text)].length).toBe(LABEL_MAX);
    const nearLong = pinLabel(pin, place({ name: long, point: { lat: 45.8, lng: 24.15 } }), text);
    expect([...nearLong].length).toBeLessThanOrEqual(LABEL_MAX);
    expect(nearLong.startsWith('Near AAA')).toBe(true);
    const area = pinLabel(pin, place({ kind: 'area', name: long, areaName: long }), text);
    expect([...area].length).toBeLessThanOrEqual(LABEL_MAX);
    expect(area.startsWith('Pin in ')).toBe(true);
  });
  it('is never empty', () => {
    expect(pinLabel(pin, null, { ...text, pinned: '' })).not.toBe('');
  });
});

describe('pinPlace', () => {
  it('is a normal exact address place', () => {
    const p = pinPlace({ lat: 45.7970049, lng: 24.1500051 }, place({}), text);
    expect(p).toMatchObject({
      id: 'pin:45.79700,24.15001',
      kind: 'address',
      point: { lat: 45.797, lng: 24.15001 },
      secondary: 'Sibiu, Centru',
      areaName: 'Centru',
    });
    expect(p.approximate).toBeUndefined();
  });
  it('works without a lookup result', () => {
    const p = pinPlace(pin, null, text);
    expect(p.name).toBe('Pinned location');
    expect(p.secondary).toBe('');
    expect(p.point).toEqual(pin);
  });
});

describe('createLookup', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  function setup(fetcher: (p: LatLng, s: AbortSignal) => Promise<string>) {
    const states: LookupState<string>[] = [];
    const lookup = createLookup<string>({
      delayMs: 350,
      fetch: fetcher,
      onState: (s) => states.push(s),
    });
    return { states, lookup };
  }

  it('waits for the delay, then loads and reports done', async () => {
    const { states, lookup } = setup(() => Promise.resolve('ok'));
    lookup.schedule(pin);
    await vi.advanceTimersByTimeAsync(349);
    expect(states).toEqual([]);
    await vi.advanceTimersByTimeAsync(1);
    expect(states.map((s) => s.status)).toEqual(['loading', 'done']);
  });

  it('a newer schedule replaces a pending one (one request only)', async () => {
    const fetcher = vi.fn((_p: LatLng, _s: AbortSignal) => Promise.resolve('ok'));
    const { lookup } = setup(fetcher);
    lookup.schedule(pin);
    await vi.advanceTimersByTimeAsync(200);
    lookup.schedule({ lat: 45.8, lng: 24.2 });
    await vi.advanceTimersByTimeAsync(400);
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(fetcher.mock.calls[0]?.[0]).toEqual({ lat: 45.8, lng: 24.2 });
  });

  it('aborts the stale request and ignores its late answer', async () => {
    const signals: AbortSignal[] = [];
    const resolvers: Array<(v: string) => void> = [];
    const { states, lookup } = setup((_p, s) => {
      signals.push(s);
      return new Promise<string>((res) => resolvers.push(res));
    });
    lookup.schedule(pin);
    await vi.advanceTimersByTimeAsync(350);
    lookup.schedule({ lat: 45.8, lng: 24.2 });
    expect(signals[0]?.aborted).toBe(true);
    resolvers[0]?.('stale');
    await vi.advanceTimersByTimeAsync(350);
    resolvers[1]?.('fresh');
    await vi.advanceTimersByTimeAsync(0);
    const done = states.filter((s) => s.status === 'done');
    expect(done).toHaveLength(1);
    expect(done[0]).toMatchObject({ value: 'fresh' });
  });

  it('reports failures but not aborts, and cancel() stops everything', async () => {
    const { states, lookup } = setup(() => Promise.reject(new Error('boom')));
    lookup.schedule(pin);
    await vi.advanceTimersByTimeAsync(350);
    expect(states.map((s) => s.status)).toEqual(['loading', 'failed']);

    const fetcher = vi.fn((_p: LatLng, _s: AbortSignal) => Promise.resolve('ok'));
    const second = setup(fetcher);
    second.lookup.schedule(pin);
    second.lookup.cancel();
    await vi.advanceTimersByTimeAsync(1000);
    expect(fetcher).not.toHaveBeenCalled();
    expect(second.states).toEqual([]);
  });
});
