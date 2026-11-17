import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '@/api/client';
import { ToastProvider } from '@/ui/Toast';

const api = vi.hoisted(() => ({ deleteAccount: vi.fn(), requestDataExport: vi.fn() }));
const auth = vi.hoisted(() => ({ signOut: vi.fn() }));
vi.mock('@/api/privacy', () => api);
vi.mock('@/auth/AuthProvider', () => ({
  useAuth: () => ({ status: 'signedIn', signOut: auth.signOut }),
}));
vi.mock('@/ui/Loader', () => ({ Loader: () => <div role="status">Loading</div> }));

import DeleteAccountScreen from './DeleteAccountScreen';
import { PrivacyRows } from './PrivacyRows';

function wrap(ui: React.ReactElement, path = '/delete') {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <ToastProvider>
        <MemoryRouter initialEntries={[path]}>
          <Routes>
            <Route path="/delete" element={ui} />
            <Route path="/" element={<p>home</p>} />
            <Route path="/profile" element={<p>profile</p>} />
          </Routes>
        </MemoryRouter>
      </ToastProvider>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  api.deleteAccount.mockReset();
  api.requestDataExport.mockReset();
  auth.signOut.mockReset().mockResolvedValue(undefined);
});
afterEach(cleanup);

describe('DeleteAccountScreen', () => {
  it('states the consequences and keeps the account when asked, without any call', () => {
    wrap(<DeleteAccountScreen />);
    expect(screen.getByRole('heading', { level: 1, name: 'Delete your account?' })).toBeTruthy();
    expect(screen.getByText(/upcoming rides and bookings are cancelled/)).toBeTruthy();
    expect(screen.getByText(/shown as “Deleted user”/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Keep my account' }));
    expect(api.deleteAccount).not.toHaveBeenCalled();
    expect(screen.getByText('profile')).toBeTruthy();
  });

  it('deletes, signs out, leaves the screen and confirms with a toast', async () => {
    api.deleteAccount.mockResolvedValue(undefined);
    wrap(<DeleteAccountScreen />);
    fireEvent.click(screen.getByRole('button', { name: 'Delete account' }));
    await waitFor(() => expect(auth.signOut).toHaveBeenCalledTimes(1));
    // The navigation commits asynchronously: wait for it instead of asserting right after signOut.
    expect(await screen.findByText('home')).toBeTruthy();
    expect(
      await screen.findByText('Account deleted. We erase your data within 30 days.'),
    ).toBeTruthy();
  });

  it('shows an inline error and stays signed in when deletion fails', async () => {
    api.deleteAccount.mockRejectedValue(new ApiError({ code: 'INTERNAL', status: 503 }));
    wrap(<DeleteAccountScreen />);
    fireEvent.click(screen.getByRole('button', { name: 'Delete account' }));
    expect(await screen.findByText('We couldn’t delete your account. Try again.')).toBeTruthy();
    expect(auth.signOut).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Delete account' }).hasAttribute('disabled')).toBe(
      false,
    );
  });
});

describe('PrivacyRows', () => {
  it('confirms the data request in the row with both dates', async () => {
    api.requestDataExport.mockResolvedValue({
      requestId: 'q-1',
      requestedAt: new Date().toISOString(),
      dueBy: '2030-01-30T10:00:00Z',
    });
    wrap(
      <ul>
        <PrivacyRows />
      </ul>,
    );
    fireEvent.click(screen.getByRole('button', { name: /Request a copy of my data/ }));
    expect(
      await screen.findByText(/Request sent on .* We’ll reply by 30 January 2030\./),
    ).toBeTruthy();
    expect(api.requestDataExport).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('link', { name: 'Delete account' }).getAttribute('href')).toBe(
      '/delete',
    );
  });
});
