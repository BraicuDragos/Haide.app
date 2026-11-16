import type { LatLng } from '@/api/types';

/**
 * The seat request in flight, kept in sessionStorage (this tab only) so the same `Idempotency-Key` is reused on every
 * retry of one attempt: a lost response or a queued offline request can never create a second booking.
 * The places stay in the tab's own session storage and are removed as soon as the attempt is settled.
 */
export interface PendingRequest {
  key: string;
  rideId: string;
  from: LatLng;
  to: LatLng;
  /** True once it was queued because the device was offline (or the server did not answer). */
  queued: boolean;
}

const KEY = 'haide.pendingRequest';

export const newKey = (): string => crypto.randomUUID();

export function readPending(rideId: string): PendingRequest | null {
  try {
    const raw = sessionStorage.getItem(KEY);
    if (!raw) return null;
    const v = JSON.parse(raw) as Partial<PendingRequest>;
    if (v.rideId !== rideId || typeof v.key !== 'string' || !v.from || !v.to) return null;
    return { key: v.key, rideId, from: v.from, to: v.to, queued: v.queued === true };
  } catch {
    return null;
  }
}

export function savePending(p: PendingRequest): void {
  try {
    sessionStorage.setItem(KEY, JSON.stringify(p));
  } catch {
    /* storage can be blocked: the request then simply is not queued across a reload */
  }
}

export function clearPending(): void {
  try {
    sessionStorage.removeItem(KEY);
  } catch {
    /* ignore */
  }
}

const same = (a: LatLng, b: LatLng) => a.lat === b.lat && a.lng === b.lng;

/**
 * The key for this attempt: the saved one when the same ride and places are retried, else a fresh uuid
 * (saved straight away, so a reload mid-request reuses it).
 */
export function keyFor(rideId: string, from: LatLng, to: LatLng): string {
  const cur = readPending(rideId);
  if (cur && same(cur.from, from) && same(cur.to, to)) return cur.key;
  const key = newKey();
  savePending({ key, rideId, from, to, queued: false });
  return key;
}

export const isOffline = (): boolean =>
  typeof navigator !== 'undefined' && navigator.onLine === false;
