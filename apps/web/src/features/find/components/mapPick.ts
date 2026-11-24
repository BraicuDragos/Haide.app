import type { LatLng, Place } from '@/api/types';

/**
 * Pure helpers for choosing a place on the map. No React, no MapLibre: everything here runs (and is tested) in node.
 */

/** Sibiu coverage box, the same numbers as COVERAGE_BBOX on the server (the server rejects points outside). */
export const COVERAGE = { south: 45.68, west: 23.98, north: 45.86, east: 24.32 } as const;

/** Where the map starts when nothing is chosen yet (centre of Sibiu). */
export const DEFAULT_CENTRE: LatLng = { lat: 45.797, lng: 24.15 };
export const DEFAULT_ZOOM = 13;
export const CHOSEN_ZOOM = 15.5;

/** A pin this close to a found address, POI or street takes that place's name as its label. */
export const NEAR_M = 60;
export const LABEL_MAX = 80;

/** Edges are inclusive, like the server's `inCoverage`. */
export function inCoverage(p: LatLng): boolean {
  return (
    p.lat >= COVERAGE.south &&
    p.lat <= COVERAGE.north &&
    p.lng >= COVERAGE.west &&
    p.lng <= COVERAGE.east
  );
}

/** Contract precision: 5 decimals is about 1 m. */
export function round5(n: number): number {
  return Math.round(n * 1e5) / 1e5;
}

export function roundPoint(p: LatLng): LatLng {
  return { lat: round5(p.lat), lng: round5(p.lng) };
}

/** Great-circle distance in metres. */
export function distanceM(a: LatLng, b: LatLng): number {
  const R = 6_371_000;
  const rad = (d: number) => (d * Math.PI) / 180;
  const dLat = rad(b.lat - a.lat);
  const dLng = rad(b.lng - a.lng);
  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

export function pinId(p: LatLng): string {
  const r = roundPoint(p);
  return `pin:${r.lat.toFixed(5)},${r.lng.toFixed(5)}`;
}

/** Text pieces for the generated labels, supplied by the caller from the i18n files. */
export interface LabelText {
  near: (name: string) => string;
  inArea: (area: string) => string;
  pinned: string;
}

function clip(s: string, max: number): string {
  const chars = [...s.trim()];
  return chars.length <= max ? chars.join('') : `${chars.slice(0, max - 1).join('')}…`;
}

/** Fits `make(name)` into LABEL_MAX by shortening the name part, so the "Near " prefix never gets cut. */
function fit(make: (name: string) => string, name: string): string {
  const full = make(name);
  if ([...full].length <= LABEL_MAX) return full;
  const over = [...full].length - LABEL_MAX;
  return make(clip(name, Math.max(1, [...name.trim()].length - over)));
}

/**
 * The label the From/To field shows and Publish sends. Rule, in order:
 * 1. the reverse place is within 60 m of the pin and is an address, POI or street: its own name;
 * 2. the reverse lookup found something else (or something farther): "Near <name>";
 * 3. no place but a known area: "Pin in <area>";
 * 4. otherwise "Pinned location". At most 80 characters, never empty.
 */
export function pinLabel(pin: LatLng, found: Place | null, text: LabelText): string {
  const name = found?.name.trim() ?? '';
  if (found && name) {
    const close = distanceM(pin, found.point) <= NEAR_M;
    if (close && (found.kind === 'address' || found.kind === 'poi' || found.kind === 'street')) {
      return clip(name, LABEL_MAX);
    }
    if (found.kind !== 'area') return fit(text.near, name);
  }
  const area = (found?.areaName ?? '').trim() || (found?.kind === 'area' ? name : '');
  if (area) return fit(text.inArea, area);
  return clip(text.pinned, LABEL_MAX) || 'Pinned location';
}

/** The normal Place the picker returns for a pin: exact point (not approximate), kind address. */
export function pinPlace(pin: LatLng, found: Place | null, text: LabelText): Place {
  const point = roundPoint(pin);
  const secondary = (found?.secondary ?? '').trim() || (found?.areaName ?? '').trim();
  return {
    id: pinId(point),
    name: pinLabel(point, found, text),
    secondary,
    kind: 'address',
    point,
    areaName: (found?.areaName ?? '').trim(),
  };
}

// ---------------------------------------------------------------------------------------------------------------------
// Debounced, abortable reverse lookup (the logic is pure: timers and the fetcher are injected).

export type LookupState<T> =
  | { status: 'idle' }
  | { status: 'loading'; point: LatLng }
  | { status: 'done'; point: LatLng; value: T }
  | { status: 'failed'; point: LatLng; error: unknown };

export interface Lookup {
  /** Starts (or restarts) the countdown for this point; any lookup in flight is aborted. */
  schedule: (point: LatLng) => void;
  /** Forgets everything pending (the map moved again, or the sheet closed). */
  cancel: () => void;
}

export function createLookup<T>(opts: {
  delayMs: number;
  fetch: (point: LatLng, signal: AbortSignal) => Promise<T>;
  onState: (state: LookupState<T>) => void;
}): Lookup {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let ctrl: AbortController | undefined;
  let seq = 0;

  function cancel() {
    seq += 1;
    if (timer !== undefined) clearTimeout(timer);
    timer = undefined;
    ctrl?.abort();
    ctrl = undefined;
  }

  function schedule(point: LatLng) {
    cancel();
    const mine = seq;
    timer = setTimeout(() => {
      timer = undefined;
      const c = new AbortController();
      ctrl = c;
      opts.onState({ status: 'loading', point });
      opts.fetch(point, c.signal).then(
        (value) => {
          if (mine === seq) opts.onState({ status: 'done', point, value });
        },
        (error: unknown) => {
          if (mine === seq && !c.signal.aborted) opts.onState({ status: 'failed', point, error });
        },
      );
    }, opts.delayMs);
  }

  return { schedule, cancel };
}
