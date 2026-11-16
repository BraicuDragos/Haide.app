import { useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router';
import { postBooking } from '@/api/bookings';
import { ApiError } from '@/api/client';
import { keys } from '@/api/keys';
import { clearPending, isOffline, readPending } from './pendingRequest';

/**
 * One queued seat request per ride (offline, or no answer from the server). While the app is open it is sent again
 * with the same `Idempotency-Key` when the browser reports `online`, so it can never create two bookings.
 * A decision from the server (any 4xx) ends the attempt and is reported as an error code.
 */
export function useQueuedRequest(rideId: string, enabled: boolean) {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [queued, setQueued] = useState(() => readPending(rideId)?.queued === true);
  const [error, setError] = useState<string | null>(null);
  const busy = useRef(false);

  const flush = useCallback(async () => {
    const p = readPending(rideId);
    if (!enabled || busy.current || !p?.queued || isOffline()) return;
    busy.current = true;
    try {
      const view = await postBooking({ rideId, from: p.from, to: p.to }, p.key);
      clearPending();
      setQueued(false);
      qc.setQueryData(keys.bookings.one(view.id), view);
      void qc.invalidateQueries({ queryKey: keys.bookings.all });
      void qc.invalidateQueries({ queryKey: keys.summary });
      void qc.invalidateQueries({ queryKey: keys.ride(rideId) });
      void navigate(`/booking/${view.id}`);
    } catch (e) {
      if (e instanceof ApiError && e.code !== 'NETWORK') {
        clearPending();
        setQueued(false);
        setError(e.code);
        void qc.invalidateQueries({ queryKey: keys.ride(rideId) });
      }
    } finally {
      busy.current = false;
    }
  }, [rideId, enabled, qc, navigate]);

  // On mount (a reload with a queued request) and whenever the browser reports it is back online. Marking a request
  // as queued does not retry at once: the connection just failed.
  useEffect(() => {
    void flush();
    window.addEventListener('online', flush);
    return () => window.removeEventListener('online', flush);
  }, [flush]);

  return { queued, error, markQueued: () => setQueued(true), clearError: () => setError(null) };
}
