import { QueryCache, QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useState, type ReactNode } from 'react';
import { ApiError } from '@/api/client';
import { keys } from '@/api/keys';
import { AuthProvider } from '@/auth/AuthProvider';
import { ToastProvider } from '@/ui/Toast';

const GATE_CODES = new Set(['CONSENT_REQUIRED', 'PROFILE_INCOMPLETE', 'VEHICLE_REQUIRED']);

function makeClient(): QueryClient {
  const client: QueryClient = new QueryClient({
    // A gate error means our cached /me is stale (for example a terms version bump): refetch it.
    queryCache: new QueryCache({
      onError: (err) => {
        if (err instanceof ApiError && GATE_CODES.has(err.code)) {
          void client.invalidateQueries({ queryKey: keys.me });
        }
      },
    }),
    defaultOptions: {
      queries: {
        staleTime: 30_000,
        refetchOnWindowFocus: false,
        // Retry network blips once, never retry 4xx (validation, rate limit, not found).
        retry: (count, err) =>
          count < 1 && !(err instanceof ApiError && err.status >= 400 && err.status < 500),
      },
    },
  });
  return client;
}

/** Server state via TanStack Query only (conventions section 8). Auth is the one other global. */
export function Providers({ children }: { children: ReactNode }) {
  const [client] = useState(makeClient);
  return (
    <QueryClientProvider client={client}>
      <ToastProvider>
        <AuthProvider>{children}</AuthProvider>
      </ToastProvider>
    </QueryClientProvider>
  );
}
