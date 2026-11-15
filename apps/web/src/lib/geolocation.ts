import type { LatLng } from '@/api/types';

export class GeolocationFailure extends Error {
  readonly reason: 'denied' | 'unavailable' | 'timeout';
  constructor(reason: 'denied' | 'unavailable' | 'timeout') {
    super(reason);
    this.reason = reason;
  }
}

/**
 * One-shot position, foreground only, called from an explicit tap (conventions section 6, rule 6).
 * Never use watchPosition. Coordinates are rounded to 5 decimals (about 1 m), the contract's exact precision.
 */
export function getCurrentPoint(): Promise<LatLng> {
  return new Promise((resolve, reject) => {
    if (!('geolocation' in navigator)) {
      reject(new GeolocationFailure('unavailable'));
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (pos) =>
        resolve({
          lat: Math.round(pos.coords.latitude * 1e5) / 1e5,
          lng: Math.round(pos.coords.longitude * 1e5) / 1e5,
        }),
      (err) =>
        reject(
          new GeolocationFailure(
            err.code === err.PERMISSION_DENIED
              ? 'denied'
              : err.code === err.TIMEOUT
                ? 'timeout'
                : 'unavailable',
          ),
        ),
      { enableHighAccuracy: false, timeout: 10_000, maximumAge: 0 },
    );
  });
}
