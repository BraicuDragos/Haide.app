import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '@/api/client';
import type { PopularRoute } from '@/api/types';

const api = vi.hoisted(() => ({ getPopularRoutes: vi.fn() }));
vi.mock('@/api/popular', () => api);
vi.mock('@/ui/Loader', () => ({
  Loader: ({ label }: { label: string }) => <div role="status">{label}</div>,
}));

import { readSearch } from '../searchState';
import { PopularRoutes, criteriaFor } from './PopularRoutes';

const place = (id: string, name: string) => ({
  id,
  name,
  secondary: 'Sibiu',
  kind: 'area' as const,
  point: { lat: 45.8, lng: 24.1 },
  areaName: name,
});
const route = (over: Partial<PopularRoute> = {}): PopularRoute => ({
  from: place('p-1', 'Șelimbăr'),
  to: place('p-2', 'Zona Industrială Vest'),
  rides: 7,
  source: 'data',
  ...over,
});

function show() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={['/find']}>
        <Routes>
          <Route path="/find" element={<PopularRoutes />} />
          <Route path="/results" element={<p>results page</p>} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  api.getPopularRoutes.mockReset();
  sessionStorage.clear();
});
afterEach(cleanup);

describe('PopularRoutes', () => {
  it('lists the routes as buttons; real routes show a count, curated ones do not', async () => {
    api.getPopularRoutes.mockResolvedValue({
      items: [
        route(),
        route({
          from: place('p-3', 'Cisnădie'),
          to: place('p-4', 'Piața Mare'),
          rides: 0,
          source: 'curated',
        }),
      ],
    });
    show();
    expect(screen.getByRole('heading', { level: 2, name: 'Popular routes' })).toBeTruthy();
    const real = await screen.findByRole('button', { name: /^Șelimbăr to Zona Industrială Vest/ });
    expect(real.textContent).toContain('7 rides lately');
    const curated = screen.getByRole('button', { name: 'Cisnădie to Piața Mare' });
    expect(curated.textContent).not.toMatch(/rides?/);
    expect(screen.getAllByText(/rides? lately/)).toHaveLength(1);
  });

  it('shows a loading state, then the list', async () => {
    api.getPopularRoutes.mockReturnValue(new Promise(() => undefined));
    show();
    expect(screen.getByRole('status').textContent).toBe('Loading popular routes');
    expect(screen.getByRole('region', { name: 'Popular routes' }).getAttribute('aria-busy')).toBe(
      'true',
    );
  });

  it('shows an error with a working Retry', async () => {
    api.getPopularRoutes.mockRejectedValueOnce(new ApiError({ status: 500, code: 'UNKNOWN' }));
    show();
    expect(await screen.findByRole('alert')).toBeTruthy();
    api.getPopularRoutes.mockResolvedValue({ items: [route()] });
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(
      await screen.findByRole('button', { name: /^Șelimbăr to Zona Industrială Vest/ }),
    ).toBeTruthy();
  });

  it('shows a calm empty text', async () => {
    api.getPopularRoutes.mockResolvedValue({ items: [] });
    show();
    expect(await screen.findByText(/No popular routes yet/)).toBeTruthy();
  });

  it('a tap saves the search with the returned places and opens the results', async () => {
    const r = route();
    api.getPopularRoutes.mockResolvedValue({ items: [r] });
    show();
    fireEvent.click(
      await screen.findByRole('button', { name: /^Șelimbăr to Zona Industrială Vest/ }),
    );
    expect(await screen.findByText('results page')).toBeTruthy();
    await waitFor(() => expect(readSearch()).not.toBeNull());
    const saved = readSearch()!;
    expect(saved.from).toEqual(r.from);
    expect(saved.to).toEqual(r.to);
    expect(saved.win).toBe('60');
    expect(saved.day).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(saved.time).toMatch(/^\d{2}:\d{2}$/);
    expect(Number(saved.time.slice(3)) % 5).toBe(0);
  });
});

describe('tap moment', () => {
  const NAME = /^Șelimbăr to Zona Industrială Vest/;
  const root = document.documentElement;

  async function ready() {
    api.getPopularRoutes.mockResolvedValue({ items: [route()] });
    show();
    return screen.findByRole('button', { name: NAME });
  }

  beforeEach(() => {
    root.style.setProperty('--tk-dur-reveal', '700ms');
    root.style.setProperty('--tk-dur-fast', '120ms');
    delete root.dataset.motion;
  });
  afterEach(() => {
    vi.useRealTimers();
    root.style.removeProperty('--tk-dur-reveal');
    root.style.removeProperty('--tk-dur-fast');
    delete root.dataset.motion;
  });

  it('plays the moment, announces it, and opens the results after it', async () => {
    const btn = await ready();
    vi.useFakeTimers();
    fireEvent.click(btn);
    expect(btn.className).toContain('is-picked');
    expect(screen.getByText('Searching rides from Șelimbăr to Zona Industrială Vest')).toBeTruthy();
    expect(btn.getAttribute('aria-label')).toBeNull();
    // Hold: the results are not open yet and nothing is saved yet.
    act(() => void vi.advanceTimersByTime(699));
    expect(screen.queryByText('results page')).toBeNull();
    expect(sessionStorage.getItem('haide.search')).toBeNull();
    act(() => void vi.advanceTimersByTime(1));
    expect(screen.getByText('results page')).toBeTruthy();
    expect(sessionStorage.getItem('haide.search')).toContain('p-1');
  });

  it('with reduced motion there is no animation, only a short highlight', async () => {
    root.dataset.motion = 'reduced';
    const btn = await ready();
    vi.useFakeTimers();
    fireEvent.click(btn);
    expect(btn.className).toContain('is-picked');
    expect(screen.queryByTestId('route-launch')).toBeNull();
    act(() => void vi.advanceTimersByTime(119));
    expect(screen.queryByText('results page')).toBeNull();
    act(() => void vi.advanceTimersByTime(1));
    expect(screen.getByText('results page')).toBeTruthy();
  });

  it('ignores taps while launching', async () => {
    const btn = await ready();
    vi.useFakeTimers();
    fireEvent.click(btn);
    fireEvent.click(btn);
    fireEvent.click(btn);
    act(() => void vi.advanceTimersByTime(700));
    expect(screen.getByText('results page')).toBeTruthy();
    expect(api.getPopularRoutes).toHaveBeenCalledTimes(1);
  });

  it('does not navigate when unmounted mid-animation', async () => {
    const btn = await ready();
    vi.useFakeTimers();
    fireEvent.click(btn);
    cleanup();
    act(() => void vi.advanceTimersByTime(1000));
    expect(sessionStorage.getItem('haide.search')).toBeNull();
  });
});

describe('criteriaFor', () => {
  it('uses today and the next 5 minute slot in Bucharest', () => {
    // 10:02 UTC is 12:02 in Bucharest in winter (UTC+2).
    const c = criteriaFor(route(), new Date('2026-01-14T10:02:10Z'));
    expect(c).toMatchObject({ day: '2026-01-14', time: '12:05', win: '60' });
  });

  it('moves to tomorrow morning when no slot is left today', () => {
    const c = criteriaFor(route(), new Date('2026-01-14T21:58:00Z')); // 23:58 in Bucharest
    expect(c).toMatchObject({ day: '2026-01-15', time: '07:00' });
  });
});
