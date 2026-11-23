import type { LatLng } from '@/api/types';

/**
 * The thin seam between the map picker UI and MapLibre. The UI only knows this interface, so jsdom tests drive it with a
 * fake and the MapLibre code (maplibreAdapter.ts) stays in its own lazy chunk.
 */
export interface MapHandle {
  getCenter: () => LatLng;
  /** Jump (never animate) to a point, optionally with a zoom. */
  jumpTo: (point: LatLng, zoom?: number) => void;
  /** Zoom in (+1) or out (-1) around the centre; no animation when `animate` is false (reduced motion). */
  zoomBy: (delta: number, animate: boolean) => void;
  resize: () => void;
  destroy: () => void;
}

export interface MapEvents {
  onMoveStart: () => void;
  onMove: (centre: LatLng) => void;
  onMoveEnd: (centre: LatLng) => void;
  onReady: () => void;
}

export interface CreateMapOptions {
  centre: LatLng;
  zoom: number;
}

/** Resolves with a handle once the map exists; rejects when tiles or WebGL are not available. */
export type CreateMap = (
  host: HTMLElement,
  options: CreateMapOptions,
  events: MapEvents,
) => Promise<MapHandle>;
