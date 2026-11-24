import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '@/api/client';
import type { OwnerRide } from '@/api/types';
import { bucharestToIso, dayOptions } from '@/lib/dates';
import { ToastProvider } from '@/ui/Toast';

const api = vi.hoisted(() => ({
  patchRide: vi.fn(),
  getMyRide: vi.fn(),
  postRideCancel: vi.fn(),
  getVehicle: vi.fn(),
}));
vi.mock('@/api/rides', () => ({
  patchRide: api.patchRide,
  getMyRide: api.getMyRide,
  postRideCancel: api.postRideCancel,
}));
vi.mock('@/api/account', () => ({ getVehicle: api.getVehicle }));
vi.mock('@/api/liquidity', () => ({ patchRideAutoAccept: vi.fn(), postSeriesCancel: vi.fn() }));
vi.mock('@/auth/AuthProvider', () => ({ useAuth: () => ({ status: 'signedIn' }) }));
vi.mock('@/auth/hooks', () => ({ useStartAuth: () => vi.fn() }));
vi.mock('./components/OwnerMap', () => ({ OwnerMap: () => <div /> }));
vi.mock('@/ui/Loader', () => ({
  Loader: ({ label }: { label: string }) => <div role="status">{label}</div>,
}));

import { EditRideSheet } from './components/EditRideSheet';
import DrivingRideScreen from './screens/DrivingRideScreen';

beforeAll(() => {
  // jsdom has no modal dialog support
  const proto = HTMLDialogElement.prototype;
  proto.showModal = function (this: HTMLDialogElement) {
    this.setAttribute('open', '');
  };
  proto.close = function (this: HTMLDialogElement) {
    this.removeAttribute('open');
    this.dispatchEvent(new Event('close'));
  };
});
beforeEach(() => {
  api.getVehicle.mockResolvedValue({ seats: 4, fuelType: 'diesel' });
});
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

const days = dayOptions(15);
const DEPARTS = bucharestToIso(days[3]!.value, '07:30');

const person = {
  id: 'u-9',
  firstName: 'Radu',
  photoUrl: null,
  memberSince: '2026-09',
  rating: null,
  ridesCompleted: 0,
  lateCancellations90d: 0,
  noShows90d: 0,
  bio: null,
};

const ride = (over: Partial<OwnerRide> = {}): OwnerRide =>
  ({
    id: '10000000-0000-4000-8000-000000000001',
    status: 'published',
    departureAt: DEPARTS,
    origin: { point: { lat: 45.76, lng: 24.21 }, label: 'Șelimbăr', approximate: false },
    destination: {
      point: { lat: 45.79, lng: 24.1 },
      label: 'Zona Industrială Vest',
      approximate: false,
    },
    route: { type: 'LineString', coordinates: [] },
    distanceM: 9588,
    durationS: 1020,
    seatsOffered: 3,
    seatsBooked: 0,
    note: 'Near the red kiosk',
    isFree: false,
    autoAccept: false,
    series: null,
    priceTable: [{ passengers: 1, priceBani: 310 }],
    tripCostBani: 624,
    fuelType: 'diesel',
    car: { make: 'Dacia', model: 'Logan', colour: 'Grey' },
    requests: [],
    passengers: [],
    canCancel: true,
    canEdit: true,
    lateCancelIfNow: false,
    lateCancel: false,
    cancelledAt: null,
    createdAt: '2026-11-20T10:00:00Z',
    ...over,
  }) as unknown as OwnerRide;

const pending = {
  bookingId: 'b-1',
  passenger: person,
  pickupLabel: 'A',
  dropoffLabel: 'B',
  segmentM: 5000,
  priceIfAcceptedBani: 200,
  requestedAt: '2026-11-21T10:00:00Z',
  expiresAt: '2026-11-22T10:00:00Z',
};
const confirmed = {
  bookingId: 'b-2',
  status: 'confirmed',
  passenger: person,
  pickup: { label: 'A' },
  dropoff: { label: 'B' },
  phoneE164: null,
  priceLockedBani: 200,
  finalPriceBani: null,
} as unknown as OwnerRide['passengers'][number];

function renderSheet(r: OwnerRide, onClose = vi.fn()) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={qc}>
      <ToastProvider>
        <EditRideSheet ride={r} open onClose={onClose} />
      </ToastProvider>
    </QueryClientProvider>,
  );
  return { qc, onClose };
}

const save = () => screen.getByRole('button', { name: 'Save changes' }) as HTMLButtonElement;
const dayField = () => screen.getByRole('button', { name: /^Day/ });
/** Opens the Day wheel, taps the day and sets it. */
const chooseDay = (value: string) => {
  fireEvent.click(dayField());
  const wheel = screen.getByRole('listbox', { name: 'Day' });
  fireEvent.click(wheel.querySelector(`[data-value="${value}"]`)!);
  fireEvent.click(screen.getByRole('button', { name: 'Set day' }));
};
const pickLater = () => chooseDay(days[4]!.value);
const noteField = () => screen.getByLabelText(/Note for passengers/) as HTMLTextAreaElement;

describe('EditRideSheet', () => {
  it('is prefilled from the ride and says the route cannot change', () => {
    renderSheet(ride({ autoAccept: true }));
    expect(dayField().textContent).toContain(days[3]!.label);
    expect(screen.getByRole('button', { name: /Leaving at/ }).textContent).toContain('07:30');
    expect(noteField().value).toBe('Near the red kiosk');
    expect((screen.getByRole('switch') as HTMLInputElement).checked).toBe(true);
    expect((screen.getByRole('radio', { name: '3 seats' }) as HTMLInputElement).checked).toBe(true);
    expect(screen.getByText(/route and the price can’t be changed/)).toBeTruthy();
  });

  it('keeps Save disabled until something changes, and again when it is changed back', () => {
    renderSheet(ride());
    expect(save().disabled).toBe(true);
    fireEvent.click(screen.getByRole('radio', { name: '2 seats' }));
    expect(save().disabled).toBe(false);
    fireEvent.click(screen.getByRole('radio', { name: '3 seats' }));
    expect(save().disabled).toBe(true);
  });

  it('sends only the changed fields and closes with a toast', async () => {
    api.patchRide.mockResolvedValue(ride({ seatsOffered: 2 }));
    const { onClose, qc } = renderSheet(ride());
    fireEvent.click(screen.getByRole('radio', { name: '2 seats' }));
    fireEvent.click(save());
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(api.patchRide).toHaveBeenCalledWith('10000000-0000-4000-8000-000000000001', {
      seats: 2,
    });
    expect(qc.getQueryData(['rides', 'mine', '10000000-0000-4000-8000-000000000001'])).toBeTruthy();
    expect(screen.getByText('Ride updated')).toBeTruthy();
  });

  it('clears the note with null and sends a new time as an ISO instant', async () => {
    api.patchRide.mockResolvedValue(ride());
    renderSheet(ride());
    fireEvent.change(noteField(), { target: { value: '   ' } });
    pickLater();
    fireEvent.click(save());
    await waitFor(() => expect(api.patchRide).toHaveBeenCalled());
    expect(api.patchRide.mock.calls[0]![1]).toEqual({
      departureAt: bucharestToIso(days[4]!.value, '07:30'),
      note: null,
    });
  });

  it('tells how many passengers hear about a new time, and only then', async () => {
    api.patchRide.mockResolvedValue(ride());
    renderSheet(ride({ requests: [pending], passengers: [confirmed], seatsBooked: 1 }));
    expect(screen.queryByText(/will be told about the new time/)).toBeNull();
    fireEvent.change(noteField(), { target: { value: 'x' } });
    expect(screen.queryByText(/will be told about the new time/)).toBeNull();
    pickLater();
    expect(screen.getByText('2 passengers will be told about the new time.')).toBeTruthy();
    fireEvent.click(save());
    await waitFor(() => expect(screen.getByText('Ride updated, passengers told')).toBeTruthy());
  });

  it('shows no passenger notice for a ride without passengers', () => {
    renderSheet(ride());
    pickLater();
    expect(screen.queryByText(/will be told about the new time/)).toBeNull();
  });

  it('does not let seats go below the seats already taken', () => {
    renderSheet(ride({ seatsBooked: 2 }));
    expect((screen.getByRole('radio', { name: '1 seat' }) as HTMLInputElement).disabled).toBe(true);
    expect((screen.getByRole('radio', { name: '2 seats' }) as HTMLInputElement).disabled).toBe(
      false,
    );
    expect(screen.getByText(/2 seats are already taken/)).toBeTruthy();
  });

  const cases: Array<[string, ApiError, () => HTMLElement | null]> = [
    [
      'DAILY_RIDE_LIMIT -> day',
      new ApiError({ code: 'DAILY_RIDE_LIMIT', status: 409 }),
      () => dayField(),
    ],
    [
      'DEPARTURE_TOO_SOON -> time',
      new ApiError({ code: 'DEPARTURE_TOO_SOON', status: 400 }),
      () => screen.getByRole('button', { name: /Leaving at/ }),
    ],
    [
      'DEPARTURE_TOO_FAR -> time',
      new ApiError({ code: 'DEPARTURE_TOO_FAR', status: 400 }),
      () => screen.getByRole('button', { name: /Leaving at/ }),
    ],
    [
      'SEATS_BELOW_BOOKED -> seats',
      new ApiError({ code: 'SEATS_BELOW_BOOKED', status: 409, fields: { seats: 'below_booked' } }),
      () => screen.getByRole('radio', { name: '2 seats' }),
    ],
    [
      'VALIDATION_FAILED note -> note',
      new ApiError({ code: 'VALIDATION_FAILED', status: 400, fields: { note: 'too_long' } }),
      () => noteField(),
    ],
  ];
  it.each(cases)('%s: shows the message inline and focuses the field', async (_n, error, el) => {
    api.patchRide.mockRejectedValue(error);
    const { onClose } = renderSheet(ride());
    pickLater();
    fireEvent.click(screen.getByRole('radio', { name: '2 seats' }));
    fireEvent.click(save());
    await waitFor(() => expect(screen.getAllByRole('alert').length).toBeGreaterThan(0));
    expect(document.activeElement).toBe(el());
    expect(onClose).not.toHaveBeenCalled();
  });

  it('shows RIDE_NOT_EDITABLE as a banner and keeps the sheet open', async () => {
    api.patchRide.mockRejectedValue(new ApiError({ code: 'RIDE_NOT_EDITABLE', status: 409 }));
    const { onClose } = renderSheet(ride());
    fireEvent.click(screen.getByRole('radio', { name: '2 seats' }));
    fireEvent.click(save());
    await screen.findByText(/can’t be edited any more/);
    expect(onClose).not.toHaveBeenCalled();
  });

  it('refuses a time less than 15 minutes ahead without calling the server', () => {
    // A ride that leaves in 5 minutes, moved to today at a time that has already passed.
    const today = days[0]!.value;
    renderSheet(ride({ departureAt: bucharestToIso(days[1]!.value, '07:30') }));
    chooseDay(today);
    fireEvent.click(save());
    expect(api.patchRide).not.toHaveBeenCalled();
  });
});

describe('Edit ride button', () => {
  function renderScreen(r: OwnerRide) {
    api.getMyRide.mockResolvedValue(r);
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={qc}>
        <ToastProvider>
          <MemoryRouter initialEntries={[`/driving/${r.id}`]}>
            <Routes>
              <Route path="/driving/:id" element={<DrivingRideScreen />} />
            </Routes>
          </MemoryRouter>
        </ToastProvider>
      </QueryClientProvider>,
    );
  }

  it('shows Edit ride next to Cancel ride when canEdit', async () => {
    renderScreen(ride());
    expect(await screen.findByRole('button', { name: 'Edit ride' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Cancel ride' })).toBeTruthy();
  });

  it('hides Edit ride when canEdit is false', async () => {
    renderScreen(ride({ canEdit: false }));
    await screen.findByRole('button', { name: 'Cancel ride' });
    expect(screen.queryByRole('button', { name: 'Edit ride' })).toBeNull();
  });
});
