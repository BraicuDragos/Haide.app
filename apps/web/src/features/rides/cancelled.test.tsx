import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { BookingListItem, RideListItem } from '@/api/types';

const api = vi.hoisted(() => ({ getMyRides: vi.fn(), getMyBookings: vi.fn() }));
vi.mock('@/api/rides', () => ({ getMyRides: api.getMyRides }));
vi.mock('@/api/bookings', () => ({ getMyBookings: api.getMyBookings }));
vi.mock('@/auth/AuthProvider', () => ({ useAuth: () => ({ status: 'signedIn' }) }));
vi.mock('@/auth/hooks', () => ({ useStartAuth: () => vi.fn() }));
vi.mock('@/ui/Loader', () => ({
  Loader: ({ label }: { label: string }) => <div role="status">{label}</div>,
}));

import { BookingCard } from '@/features/bookings/components/BookingCard';
import { RideCard } from './components/RideCard';
import { SegTabs } from './components/SegTabs';
import RidesScreen from './screens/RidesScreen';

const driver = {
  id: 'u-2',
  firstName: 'Radu',
  photoUrl: null,
  memberSince: '2026-09',
  rating: null,
  ridesCompleted: 0,
  lateCancellations90d: 0,
  noShows90d: 0,
  bio: null,
};

const ride = (over: Partial<RideListItem> = {}): RideListItem => ({
  id: 'r-1',
  departureAt: '2026-11-17T05:25:00Z',
  originLabel: 'Șelimbăr',
  destinationLabel: 'Zona Industrială Vest',
  status: 'cancelled',
  seatsOffered: 3,
  seatsBooked: 0,
  pendingRequests: 0,
  toRate: 0,
  seriesId: null,
  cancelledAt: '2026-11-16T10:00:00Z',
  cancelledBy: 'driver',
  ...over,
});

const booking = (over: Partial<BookingListItem> = {}): BookingListItem => ({
  id: 'b-1',
  rideId: 'r-1',
  status: 'cancelled',
  rideStatus: 'published',
  departureAt: '2026-11-17T05:25:00Z',
  pickupEtaAt: '2026-11-17T05:30:00Z',
  pickupLabel: 'Șelimbăr',
  dropoffLabel: 'Zona Industrială Vest',
  driver,
  priceBani: 310,
  unseen: false,
  cancelledBy: 'passenger',
  cancelledAt: '2026-11-16T10:00:00Z',
  canRate: false,
  ...over,
});

const inRouter = (ui: React.ReactElement) => render(<MemoryRouter>{ui}</MemoryRouter>);

beforeEach(() => {
  api.getMyRides.mockReset();
  api.getMyBookings.mockReset();
});
afterEach(cleanup);

describe('RideCard, cancelled (driver)', () => {
  it('says the driver cancelled it, with a badge, the route, the time and the date', () => {
    inRouter(<RideCard ride={ride()} />);
    expect(screen.getByText('Ride cancelled')).toBeTruthy();
    expect(screen.getByText('You cancelled this ride · Cancelled Mon 16 Nov')).toBeTruthy();
    expect(screen.getByText('Șelimbăr')).toBeTruthy();
    expect(screen.getByText('Zona Industrială Vest')).toBeTruthy();
    expect(screen.getByText('07:25')).toBeTruthy();
  });

  it('reads an old ride without a canceller as cancelled by the driver', () => {
    inRouter(<RideCard ride={ride({ cancelledBy: null })} />);
    expect(screen.getByText(/^You cancelled this ride/)).toBeTruthy();
  });

  it('names Haide when the system cancelled it', () => {
    inRouter(<RideCard ride={ride({ cancelledBy: 'system' })} />);
    expect(screen.getByText(/^Cancelled by Haide/)).toBeTruthy();
  });

  it('adds nothing to a live ride', () => {
    inRouter(
      <RideCard ride={ride({ status: 'published', cancelledAt: null, cancelledBy: null })} />,
    );
    expect(screen.queryByText(/Cancelled/)).toBeNull();
  });
});

describe('BookingCard, cancelled (passenger)', () => {
  it('says "You cancelled" for the passenger own cancellation', () => {
    inRouter(<BookingCard booking={booking()} />);
    expect(screen.getByText('Cancelled')).toBeTruthy();
    expect(screen.getByText('You cancelled · Cancelled Mon 16 Nov')).toBeTruthy();
  });

  it('says the driver cancelled when the ride was cancelled', () => {
    inRouter(<BookingCard booking={booking({ cancelledBy: 'driver', rideStatus: 'cancelled' })} />);
    expect(screen.getByText('Ride cancelled')).toBeTruthy();
    expect(screen.getByText(/^Cancelled by the driver/)).toBeTruthy();
  });

  it('treats a cancelled ride without a recorded canceller as the driver', () => {
    inRouter(<BookingCard booking={booking({ cancelledBy: null, rideStatus: 'cancelled' })} />);
    expect(screen.getByText(/^Cancelled by the driver/)).toBeTruthy();
  });

  it('names Haide for a system cancellation and shows no reason', () => {
    inRouter(<BookingCard booking={booking({ cancelledBy: 'system', rideStatus: 'cancelled' })} />);
    expect(screen.getByText(/^Cancelled by Haide/)).toBeTruthy();
    expect(screen.queryByText(/reason/i)).toBeNull();
  });
});

describe('SegTabs with three options', () => {
  it('moves with the arrow keys, Home and End, and exposes tab semantics', () => {
    const onChange = vi.fn();
    render(
      <SegTabs
        prefix="when"
        label="When"
        value="past"
        onChange={onChange}
        tabs={[
          { value: 'upcoming', label: 'Upcoming' },
          { value: 'past', label: 'Past' },
          { value: 'cancelled', label: 'Cancelled' },
        ]}
      />,
    );
    expect(screen.getAllByRole('tab')).toHaveLength(3);
    const past = screen.getByRole('tab', { name: 'Past' });
    expect(past.getAttribute('aria-selected')).toBe('true');
    fireEvent.keyDown(past, { key: 'ArrowRight' });
    expect(onChange).toHaveBeenLastCalledWith('cancelled');
    fireEvent.keyDown(past, { key: 'ArrowLeft' });
    expect(onChange).toHaveBeenLastCalledWith('upcoming');
    fireEvent.keyDown(past, { key: 'End' });
    expect(onChange).toHaveBeenLastCalledWith('cancelled');
    fireEvent.keyDown(past, { key: 'Home' });
    expect(onChange).toHaveBeenLastCalledWith('upcoming');
  });
});

function screenAt(url: string) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={[url]}>
        <RidesScreen />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('RidesScreen Cancelled tab', () => {
  it('asks the driving list for the cancelled scope and lists the rides', async () => {
    api.getMyRides.mockResolvedValue({ items: [ride()], nextCursor: null });
    screenAt('/rides?role=driving&when=cancelled');
    expect(await screen.findByText(/^You cancelled this ride/)).toBeTruthy();
    expect(api.getMyRides.mock.calls[0]![0]).toBe('cancelled');
    expect(screen.getByRole('tab', { name: 'Cancelled' }).getAttribute('aria-selected')).toBe(
      'true',
    );
  });

  it('asks the riding list for the cancelled scope', async () => {
    api.getMyBookings.mockResolvedValue({ items: [booking()], nextCursor: null });
    screenAt('/rides?when=cancelled');
    expect(await screen.findByText(/^You cancelled/)).toBeTruthy();
    expect(api.getMyBookings.mock.calls[0]![0]).toBe('cancelled');
  });

  it('shows a calm empty state', async () => {
    api.getMyRides.mockResolvedValue({ items: [], nextCursor: null });
    screenAt('/rides?role=driving&when=cancelled');
    expect(await screen.findByText('No cancelled rides.')).toBeTruthy();
  });

  it('shows an error with Retry', async () => {
    api.getMyBookings.mockRejectedValue(new Error('boom'));
    screenAt('/rides?when=cancelled');
    expect(await screen.findByRole('alert')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Try again' })).toBeTruthy();
  });
});
