import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { BookingListItem, BookingView, RidePassengerItem } from '@/api/types';
import { PassengerCard } from '@/features/rides/components/PassengerCard';
import { BookingCard } from './components/BookingCard';
import { statusParts } from './components/BookingStatusPill';
import { ContactCard } from './components/ContactCard';
import { clearPending, keyFor, readPending, savePending } from './pendingRequest';
import { ridesBadgeCount } from './useSummary';

const user = {
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

const view = (over: Partial<BookingView> = {}): BookingView =>
  ({
    id: 'b-1',
    status: 'confirmed',
    rideId: 'r-1',
    rideStatus: 'published',
    viewerRole: 'passenger',
    departureAt: '2026-11-17T05:25:00Z',
    pickupEtaAt: '2026-11-17T05:30:00Z',
    requestedAt: '2026-11-16T18:00:00Z',
    expiresAt: '2026-11-16T18:30:00Z',
    decidedAt: null,
    cancelledAt: null,
    cancelledBy: null,
    pickup: { point: { lat: 45.7595, lng: 24.2128 }, label: 'Șelimbăr', walkM: 150 },
    dropoff: { point: { lat: 45.7926, lng: 24.0973 }, label: 'Zona Industrială Vest', walkM: 100 },
    segmentM: 9588,
    route: null,
    price: { quotedBani: 310, lockedBani: 260, finalBani: null, droppedFromBani: 310 },
    driver: user,
    passenger: user,
    car: { make: 'Dacia', model: 'Logan', colour: 'Grey', plate: 'SB12ABC' },
    contact: { phoneE164: '+40721234567', revealedUntil: '2026-11-18T05:25:00Z' },
    timeline: [],
    unseen: false,
    actions: {
      canCancel: true,
      lateCancelIfNow: false,
      canReportDriverNoShow: false,
      canRate: false,
      canShare: false,
      show112: false,
    },
    ...over,
  }) as BookingView;

afterEach(cleanup);

describe('ContactCard', () => {
  it('offers Call and WhatsApp links built from the phone digits only', () => {
    render(<ContactCard booking={view()} />);
    expect(screen.getByRole('link', { name: 'Call Radu' }).getAttribute('href')).toBe(
      'tel:+40721234567',
    );
    const wa = screen.getByRole('link', { name: 'Message Radu on WhatsApp' });
    expect(wa.getAttribute('href')).toBe('https://wa.me/40721234567');
    expect(wa.getAttribute('rel')).toContain('noopener');
  });

  it('renders nothing while the server sends no contact', () => {
    const { container } = render(<ContactCard booking={view({ contact: null })} />);
    expect(container.innerHTML).toBe('');
  });
});

describe('PassengerCard', () => {
  const pax = (over: Partial<RidePassengerItem> = {}): RidePassengerItem => ({
    bookingId: 'b-1',
    status: 'confirmed',
    passenger: { ...user, firstName: 'Ioana' },
    pickup: { point: { lat: 45.76, lng: 24.21 }, label: 'Șelimbăr' },
    dropoff: { point: { lat: 45.79, lng: 24.1 }, label: 'Zona Industrială Vest' },
    phoneE164: '+40721234567',
    priceLockedBani: 200,
    finalPriceBani: null,
    canMarkNoShow: false,
    canRate: false,
    noShowBy: null,
    rateUntil: null,
    ratingGiven: null,
    ...over,
  });

  it('shows Call and WhatsApp while the phone is revealed', () => {
    render(<PassengerCard passenger={pax()} onAction={vi.fn()} />);
    expect(screen.getByRole('link', { name: 'Call Ioana' })).toBeTruthy();
    expect(screen.getByText('Pays 2.00 RON')).toBeTruthy();
  });

  it('shows a locked note instead of links once the phone is hidden', () => {
    render(<PassengerCard passenger={pax({ phoneE164: null })} onAction={vi.fn()} />);
    expect(screen.queryByRole('link')).toBeNull();
    expect(screen.getByText('Phone number hidden')).toBeTruthy();
  });

  it('offers Mark no-show only when the server allows it, and reports the tap', () => {
    const onAction = vi.fn();
    const p = pax({ canMarkNoShow: true });
    const { rerender } = render(<PassengerCard passenger={p} onAction={onAction} />);
    fireEvent.click(screen.getByRole('button', { name: 'Mark no-show for Ioana' }));
    expect(onAction).toHaveBeenCalledWith('noshow', p);
    rerender(<PassengerCard passenger={pax()} onAction={onAction} />);
    expect(screen.queryByRole('button', { name: /Mark no-show/ })).toBeNull();
  });

  it('links to the Rate screen while canRate, and shows the stars once rated', () => {
    const wrap = (p: RidePassengerItem) => (
      <MemoryRouter>
        <PassengerCard passenger={p} onAction={vi.fn()} />
      </MemoryRouter>
    );
    const { rerender } = render(wrap(pax({ status: 'completed', canRate: true })));
    expect(screen.getByRole('link', { name: 'Rate Ioana' }).getAttribute('href')).toBe('/rate/b-1');
    expect(screen.getByText('Ride completed')).toBeTruthy();
    rerender(
      wrap(
        pax({
          status: 'completed',
          ratingGiven: { stars: 4, tags: [], createdAt: '2026-11-17T08:00:00Z' },
        }),
      ),
    );
    expect(screen.queryByRole('link', { name: 'Rate Ioana' })).toBeNull();
    expect(screen.getByText('You rated Ioana')).toBeTruthy();
    expect(screen.getByText('4 out of 5')).toBeTruthy();
  });

  it('shows the no-show state without a price or phone, and keeps report and block', () => {
    const onAction = vi.fn();
    const p = pax({ status: 'no_show', noShowBy: 'driver', phoneE164: null, finalPriceBani: null });
    render(<PassengerCard passenger={p} onAction={onAction} />);
    expect(screen.getByText('Marked as a no-show')).toBeTruthy();
    expect(screen.queryByText(/^Pays/)).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Report Ioana' }));
    fireEvent.click(screen.getByRole('button', { name: 'Block Ioana' }));
    expect(onAction.mock.calls.map((c) => c[0])).toEqual(['report', 'block']);
  });

  it('offers no report or block before the request is accepted', () => {
    render(<PassengerCard passenger={pax({ status: 'requested' })} onAction={vi.fn()} />);
    expect(screen.queryByRole('button', { name: 'Report Ioana' })).toBeNull();
  });
});

describe('BookingCard', () => {
  const item = (over: Partial<BookingListItem> = {}): BookingListItem => ({
    id: 'b-1',
    rideId: 'r-1',
    status: 'requested',
    rideStatus: 'published',
    departureAt: '2026-11-17T05:25:00Z',
    pickupEtaAt: '2026-11-17T05:30:00Z',
    pickupLabel: 'Șelimbăr',
    dropoffLabel: 'Zona Industrială Vest',
    driver: user,
    priceBani: 310,
    unseen: true,
    cancelledBy: null,
    cancelledAt: null,
    canRate: false,
    ...over,
  });

  it('links to the booking and says what is unseen and what the price is', () => {
    render(
      <MemoryRouter>
        <BookingCard booking={item()} />
      </MemoryRouter>,
    );
    expect(screen.getByRole('link').getAttribute('href')).toBe('/booking/b-1');
    expect(screen.getByText('Waiting for answer')).toBeTruthy();
    expect(screen.getByText('New update')).toBeTruthy();
    expect(screen.getByText('3.10 RON')).toBeTruthy();
  });
});

describe('statusParts', () => {
  it('names every status with an icon and a word', () => {
    expect(statusParts('requested').label).toBe('status.requested');
    expect(statusParts('confirmed').tone).toBe('ok');
    expect(statusParts('rejected').label).toBe('status.rejected');
    expect(statusParts('cancelled', 'cancelled').label).toBe('status.rideCancelled');
    expect(statusParts('cancelled', 'published').label).toBe('status.cancelled');
  });
});

describe('ridesBadgeCount', () => {
  it('adds pending requests and unseen updates', () => {
    expect(ridesBadgeCount(undefined)).toBe(0);
    expect(ridesBadgeCount({ driverPendingRequests: 2, passengerUnseenUpdates: 1 })).toBe(3);
  });
});

describe('pending request key', () => {
  const from = { lat: 45.7595, lng: 24.2128 };
  const to = { lat: 45.7926, lng: 24.0973 };
  beforeEach(() => clearPending());

  it('reuses the Idempotency-Key for the same ride and places, and makes a new one otherwise', () => {
    const k1 = keyFor('r-1', from, to);
    expect(keyFor('r-1', from, to)).toBe(k1);
    expect(readPending('r-1')?.queued).toBe(false);
    const k2 = keyFor('r-1', from, { lat: 45.8, lng: 24.1 });
    expect(k2).not.toBe(k1);
  });

  it('keeps a queued request for its own ride only and clears on demand', () => {
    savePending({ key: 'k', rideId: 'r-1', from, to, queued: true });
    expect(readPending('r-1')?.queued).toBe(true);
    expect(readPending('r-2')).toBeNull();
    clearPending();
    expect(readPending('r-1')).toBeNull();
  });
});
