import type { LatLng, Place, SearchRequest } from '@/api/types';

/**
 * The passenger's last search. It lives in sessionStorage (and a memory copy when storage is blocked), never in the
 * URL: places carry coordinates and location stays out of URLs and logs (conventions section 6). Results, ride detail
 * and the request sheet (E4) all read it, so the places survive reloads and the sign-in round trip in the same tab.
 */
export type Window = '15' | '30' | '60';
export interface SearchCriteria {
  from: Place;
  to: Place;
  day: string; // YYYY-MM-DD, Europe/Bucharest
  time: string; // HH:MM
  win: Window;
}

const KEY = 'haide.search';
let memory: SearchCriteria | null = null;

const isPoint = (p: unknown): p is LatLng =>
  typeof p === 'object' &&
  p !== null &&
  typeof (p as LatLng).lat === 'number' &&
  typeof (p as LatLng).lng === 'number';
const isPlace = (p: unknown): p is Place =>
  typeof p === 'object' &&
  p !== null &&
  typeof (p as Place).id === 'string' &&
  typeof (p as Place).name === 'string' &&
  isPoint((p as Place).point);

export function readSearch(): SearchCriteria | null {
  try {
    const raw = sessionStorage.getItem(KEY);
    if (raw) {
      const v = JSON.parse(raw) as Partial<SearchCriteria>;
      if (
        isPlace(v.from) &&
        isPlace(v.to) &&
        typeof v.day === 'string' &&
        typeof v.time === 'string' &&
        (v.win === '15' || v.win === '30' || v.win === '60')
      )
        return { from: v.from, to: v.to, day: v.day, time: v.time, win: v.win };
    }
  } catch {
    /* blocked or corrupt: fall through to the memory copy */
  }
  return memory;
}

export function saveSearch(c: SearchCriteria): void {
  memory = c;
  try {
    sessionStorage.setItem(KEY, JSON.stringify(c));
  } catch {
    /* the memory copy keeps it for this visit */
  }
}

const round5 = (n: number) => Math.round(n * 1e5) / 1e5;
export const toPoint = (p: LatLng): LatLng => ({ lat: round5(p.lat), lng: round5(p.lng) });

/** POST /search body (api-contract section 2). */
export function toRequest(c: SearchCriteria): SearchRequest {
  return {
    from: toPoint(c.from.point),
    to: toPoint(c.to.point),
    date: c.day,
    time: c.time,
    windowMin: Number(c.win) as SearchRequest['windowMin'],
  };
}
