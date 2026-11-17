import type { QueryClient } from '@tanstack/react-query';
import { keys } from '@/api/keys';

/** What a safety action can change: the lists, the badge, the booking and ride views, search results, blocked people. */
export function invalidateAfterSafety(
  qc: QueryClient,
  opts: { bookingId?: string; rideId?: string; userId?: string } = {},
) {
  void qc.invalidateQueries({ queryKey: keys.bookings.all });
  void qc.invalidateQueries({ queryKey: keys.rides.all });
  void qc.invalidateQueries({ queryKey: keys.summary });
  void qc.invalidateQueries({ queryKey: keys.blocks });
  void qc.invalidateQueries({ queryKey: ['search'] });
  if (opts.bookingId) void qc.invalidateQueries({ queryKey: keys.bookings.one(opts.bookingId) });
  if (opts.rideId) void qc.invalidateQueries({ queryKey: keys.rides.mine(opts.rideId) });
  if (opts.userId) qc.removeQueries({ queryKey: keys.user(opts.userId) });
}
