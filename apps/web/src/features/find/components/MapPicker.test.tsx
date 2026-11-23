import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '@/api/client';
import type { LatLng, Place } from '@/api/types';

const api = vi.hoisted(() => ({ searchPlaces: vi.fn(), reversePlace: vi.fn() }));
vi.mock('@/api/places', () => api);
vi.mock('@/ui/Loader', () => ({
  MiniLoader: ({ label }: { label: string }) => <div role="status">{label}</div>,
}));
// MapLibre never loads in jsdom: the default adapter is replaced by a fake below.
vi.mock('./maplibreAdapter', () => ({
  createMapLibre: (h: HTMLElement, o: CreateMapOptions, e: MapEvents) => fake.create(h, o, e),
}));

import type { CreateMap, CreateMapOptions, MapEvents } from './mapAdapter';
import MapPicker from './MapPicker';
import { PlacePickerSheet } from './PlacePickerSheet';

/** A fake map: the test moves it by calling `move(point)`. */
const fake = vi.hoisted(() => ({
  create: undefined as unknown as CreateMap,
  events: undefined as unknown as MapEvents,
  centre: { lat: 45.797, lng: 24.15 } as LatLng,
  fail: false,
  zooms: [] as number[],
  jumps: [] as LatLng[],
}));

const createFake: CreateMap = async (_host, options, events) => {
  if (fake.fail) throw new Error('no tiles');
  fake.events = events;
  fake.centre = options.centre;
  queueMicrotask(() => events.onReady());
  return {
    getCenter: () => fake.centre,
    jumpTo: (p) => {
      fake.centre = p;
      fake.jumps.push(p);
      events.onMoveStart();
      events.onMove(p);
      events.onMoveEnd(p);
    },
    zoomBy: (d) => void fake.zooms.push(d),
    resize: () => undefined,
    destroy: () => undefined,
  };
};
fake.create = createFake;

function move(p: LatLng) {
  act(() => {
    fake.events.onMoveStart();
    fake.events.onMove(p);
    fake.centre = p;
    fake.events.onMoveEnd(p);
  });
}

const near: Place = {
  id: 'addr-9',
  name: 'Strada Mare 9',
  secondary: 'Sibiu, Centru',
  kind: 'address',
  point: { lat: 45.797, lng: 24.1501 },
  areaName: 'Centru',
};

beforeAll(() => {
  HTMLDialogElement.prototype.showModal = function (this: HTMLDialogElement) {
    this.setAttribute('open', '');
  };
  HTMLDialogElement.prototype.close = function (this: HTMLDialogElement) {
    this.removeAttribute('open');
    this.dispatchEvent(new Event('close'));
  };
});
beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  api.reversePlace.mockReset();
  api.reversePlace.mockResolvedValue(near);
  api.searchPlaces.mockReset();
  api.searchPlaces.mockResolvedValue([]);
  fake.fail = false;
  fake.zooms = [];
  fake.jumps = [];
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

const settle = () => act(() => vi.advanceTimersByTimeAsync(400));

function show(props: Partial<React.ComponentProps<typeof MapPicker>> = {}) {
  const onPick = vi.fn();
  const onClose = vi.fn();
  render(
    <MapPicker kind="from" onPick={onPick} onClose={onClose} createMap={createFake} {...props} />,
  );
  return { onPick, onClose };
}

describe('MapPicker', () => {
  it('looks up the address after the map settles and picks an exact place', async () => {
    const { onPick } = show();
    await settle();
    expect(screen.getByTestId('map-label').textContent).toContain('Strada Mare 9');
    expect(api.reversePlace).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole('button', { name: 'Confirm' }));
    expect(onPick).toHaveBeenCalledTimes(1);
    const place = onPick.mock.calls[0]?.[0] as Place;
    expect(place).toMatchObject({
      id: 'pin:45.79700,24.15000',
      name: 'Strada Mare 9',
      kind: 'address',
      point: { lat: 45.797, lng: 24.15 },
    });
    expect(place.approximate).toBeUndefined();
  });

  it('shows Moving and disables Confirm while the map moves, then aborts stale lookups', async () => {
    show();
    await settle();
    act(() => fake.events.onMoveStart());
    expect(screen.getByText('Moving…')).toBeTruthy();
    expect((screen.getByRole('button', { name: 'Confirm' }) as HTMLButtonElement).disabled).toBe(
      true,
    );
    move({ lat: 45.8, lng: 24.16 });
    move({ lat: 45.801, lng: 24.161 });
    await settle();
    // the first settle fired one request; the two quick moves collapsed into one more
    expect(api.reversePlace).toHaveBeenCalledTimes(2);
    expect(api.reversePlace.mock.calls[1]?.[0]).toEqual({ lat: 45.801, lng: 24.161 });
  });

  it('outside the area: neutral pin, message, Confirm disabled, no lookup', async () => {
    show();
    await settle();
    api.reversePlace.mockClear();
    move({ lat: 46.77, lng: 23.59 });
    await settle();
    expect(screen.getByText('This place is outside the area we cover')).toBeTruthy();
    expect((screen.getByRole('button', { name: 'Confirm' }) as HTMLButtonElement).disabled).toBe(
      true,
    );
    expect(screen.getByTestId('map-pin').getAttribute('data-state')).toBe('outside');
    expect(api.reversePlace).not.toHaveBeenCalled();
    move({ lat: 45.797, lng: 24.15 });
    await settle();
    expect((screen.getByRole('button', { name: 'Confirm' }) as HTMLButtonElement).disabled).toBe(
      false,
    );
    expect(screen.getByTestId('map-pin').getAttribute('data-state')).toBe('ok');
  });

  it('a failed lookup offers retry and "Use this point anyway" as Pinned location', async () => {
    api.reversePlace.mockRejectedValue(new ApiError({ code: 'INTERNAL', status: 500 }));
    const { onPick } = show();
    await settle();
    expect(screen.getByText('We couldn’t look up an address for this spot.')).toBeTruthy();
    api.reversePlace.mockResolvedValue(near);
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    await settle();
    expect(screen.getByTestId('map-label').textContent).toContain('Strada Mare 9');

    api.reversePlace.mockRejectedValue(new ApiError({ code: 'INTERNAL', status: 500 }));
    move({ lat: 45.79, lng: 24.1 });
    await settle();
    fireEvent.click(screen.getByRole('button', { name: 'Use this point anyway' }));
    expect(onPick.mock.calls[0]?.[0]).toMatchObject({
      id: 'pin:45.79000,24.10000',
      name: 'Pinned location',
      kind: 'address',
    });
  });

  it('a 404 (nothing known here) is not an error: pinned location, Confirm enabled', async () => {
    api.reversePlace.mockRejectedValue(new ApiError({ code: 'NOT_FOUND', status: 404 }));
    show();
    await settle();
    expect(screen.getByTestId('map-label').textContent).toContain('Pinned location');
    expect((screen.getByRole('button', { name: 'Confirm' }) as HTMLButtonElement).disabled).toBe(
      false,
    );
  });

  it('labels a far-away result "Near ..."', async () => {
    api.reversePlace.mockResolvedValue({ ...near, point: { lat: 45.8, lng: 24.15 } });
    show();
    await settle();
    expect(screen.getByTestId('map-label').textContent).toContain('Near Strada Mare 9');
  });

  it('tiles unavailable: clear message and Search instead closes the map', async () => {
    fake.fail = true;
    const { onClose } = show();
    await settle();
    expect(screen.getByRole('alert').textContent).toContain('The map couldn’t load');
    expect(screen.queryByRole('button', { name: 'Confirm' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Search instead' }));
    expect(onClose).toHaveBeenCalled();
  });

  it('zoom buttons and My location drive the map; the map region is labelled and no-swipe', async () => {
    show();
    await settle();
    fireEvent.click(screen.getByRole('button', { name: 'Zoom in' }));
    fireEvent.click(screen.getByRole('button', { name: 'Zoom out' }));
    expect(fake.zooms).toEqual([1, -1]);
    const region = screen.getByRole('region', { name: /Map of Sibiu/ });
    expect(region.parentElement?.hasAttribute('data-no-swipe')).toBe(true);

    const geo = {
      getCurrentPosition: (ok: PositionCallback) =>
        ok({ coords: { latitude: 45.79, longitude: 24.11 } } as GeolocationPosition),
    };
    Object.defineProperty(navigator, 'geolocation', { value: geo, configurable: true });
    fireEvent.click(screen.getByRole('button', { name: 'My location' }));
    await settle();
    expect(fake.jumps).toEqual([{ lat: 45.79, lng: 24.11 }]);
  });

  it('starts at the current value of the field', async () => {
    show({ initial: { lat: 45.78, lng: 24.2 } });
    await settle();
    expect(api.reversePlace.mock.calls[0]?.[0]).toEqual({ lat: 45.78, lng: 24.2 });
  });
});

describe('PlacePickerSheet map entry', () => {
  it('shows "Choose on map" and passes the chosen place to onSelect', async () => {
    vi.useRealTimers();
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const onSelect = vi.fn();
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={qc}>
        <PlacePickerSheet open kind="to" onSelect={onSelect} onClose={() => {}} />
      </QueryClientProvider>,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Choose on map' }));
    // The default adapter is the mocked ./maplibreAdapter; wait for the lazy chunk and the lookup.
    await act(() => vi.advanceTimersByTimeAsync(800));
    expect(
      await screen.findByRole('dialog', {
        name: 'Choose your destination on the map',
        hidden: true,
      }),
    ).toBeTruthy();
    await act(() => vi.advanceTimersByTimeAsync(800));
    fireEvent.click(screen.getByRole('button', { name: 'Confirm' }));
    expect(onSelect).toHaveBeenCalledTimes(1);
    expect((onSelect.mock.calls[0]?.[0] as Place).id).toBe('pin:45.79700,24.15000');
  });
});
