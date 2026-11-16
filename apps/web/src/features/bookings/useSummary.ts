import { useQuery } from '@tanstack/react-query';
import { getSummary } from '@/api/bookings';
import { keys } from '@/api/keys';
import { useAuth } from '@/auth/AuthProvider';

/**
 * Badge counts and the next ride (GET /me/summary). Signed in only. Polls every 60 s while the tab is visible
 * (no background refetch) and refetches on focus, as the E4 spec asks.
 */
export function useSummary() {
  const { status } = useAuth();
  return useQuery({
    queryKey: keys.summary,
    queryFn: ({ signal }) => getSummary(signal),
    enabled: status === 'signedIn',
    refetchInterval: 60_000,
    refetchIntervalInBackground: false,
    refetchOnWindowFocus: true,
    staleTime: 15_000,
  });
}

/** The My rides badge: open requests on my rides plus updates on my bookings I have not opened. */
export function ridesBadgeCount(
  data: { driverPendingRequests: number; passengerUnseenUpdates: number } | undefined,
) {
  return data ? data.driverPendingRequests + data.passengerUnseenUpdates : 0;
}
