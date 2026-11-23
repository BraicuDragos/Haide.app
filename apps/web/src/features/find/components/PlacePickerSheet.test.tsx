import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Place } from '@/api/types';

const api = vi.hoisted(() => ({ searchPlaces: vi.fn(), reversePlace: vi.fn() }));
vi.mock('@/api/places', () => api);
vi.mock('@/ui/Loader', () => ({
  MiniLoader: ({ label }: { label: string }) => <div role="status">{label}</div>,
}));

import { PlacePickerSheet } from './PlacePickerSheet';

const approx: Place = {
  id: 'approx:negoveanu-2',
  name: 'Strada Negoveanu 2',
  secondary: 'Sibiu, Terezian',
  kind: 'address',
  point: { lat: 45.7856, lng: 24.1747 },
  areaName: 'Terezian',
  approximate: true,
};
const exact: Place = {
  id: 'addr-1',
  name: 'Strada Negoveanu 4',
  secondary: 'Sibiu, Terezian',
  kind: 'address',
  point: { lat: 45.785588, lng: 24.174657 },
  areaName: 'Terezian',
};

beforeAll(() => {
  // jsdom has no modal dialog support
  HTMLDialogElement.prototype.showModal = function (this: HTMLDialogElement) {
    this.setAttribute('open', '');
  };
  HTMLDialogElement.prototype.close = function (this: HTMLDialogElement) {
    this.removeAttribute('open');
  };
});
beforeEach(() => {
  api.searchPlaces.mockReset();
  api.searchPlaces.mockResolvedValue([approx, exact]);
});
afterEach(cleanup);

function show(onSelect = vi.fn()) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={qc}>
      <PlacePickerSheet open kind="from" onSelect={onSelect} onClose={() => {}} />
    </QueryClientProvider>,
  );
  return onSelect;
}

const type = (q: string) =>
  fireEvent.change(screen.getByRole('searchbox'), { target: { value: q } });

describe('PlacePickerSheet approximate suggestion', () => {
  it('lists the approximate row first, with a text badge, and selecting it passes the exact place', async () => {
    const onSelect = show();
    type('Negoveanu 2');
    await screen.findByRole('heading', { name: '2 places found' });
    const rows = screen.getAllByRole('listitem');
    expect(within(rows[0]!).getByText('Strada Negoveanu 2')).toBeTruthy();
    expect(within(rows[0]!).getByText('Approximate position')).toBeTruthy();
    expect(within(rows[1]!).queryByText('Approximate position')).toBeNull();

    fireEvent.click(within(rows[0]!).getByRole('button'));
    expect(onSelect).toHaveBeenCalledTimes(1);
    expect(onSelect.mock.calls[0]![0]).toEqual(approx);
  });

  it.each(['2/B', '2A', 'Negoveanu 2/B, bl. 5'])(
    'sends the query "%s" to the API unchanged',
    async (q) => {
      show();
      type(q);
      await waitFor(() => expect(api.searchPlaces).toHaveBeenCalled());
      expect(api.searchPlaces.mock.calls[0]![0]).toBe(q);
    },
  );

  it('does not search below two characters', async () => {
    show();
    type('N');
    await new Promise((r) => setTimeout(r, 400));
    expect(api.searchPlaces).not.toHaveBeenCalled();
  });
});
