import {
  Map as MapLibreMap,
  addProtocol,
  setWorkerUrl,
  type StyleSpecification,
} from 'maplibre-gl';
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?url';
import 'maplibre-gl/dist/maplibre-gl.css';
import { PMTiles, Protocol } from 'pmtiles';
import type { CreateMap } from './mapAdapter';
import { COVERAGE } from './mapPick';

/** Same self-hosted tile file and glyphs as ui/RouteMap (kept in step by hand: that file is shared with other screens). */
const TILES_URL = '/tiles/sibiu.pmtiles';
const GLYPH_FONT = 'Noto Sans Regular';
/** The map may be panned a little past the coverage box so the "outside the area" state can really be seen. */
const PAD = 0.03;
const MIN_ZOOM = 10.5;
const MAX_ZOOM = 18;

let protocolAdded = false;
function ensureProtocol() {
  if (protocolAdded) return;
  addProtocol('pmtiles', new Protocol().tile);
  setWorkerUrl(workerUrl);
  protocolAdded = true;
}

const css = (name: string) =>
  getComputedStyle(document.documentElement).getPropertyValue(name).trim();

function buildStyle(): StyleSpecification {
  const bg = css('--theme-map-bg');
  const text = css('--theme-map-label');
  return {
    version: 8,
    glyphs: `${window.location.origin}/glyphs/{fontstack}/{range}.pbf`,
    sources: {
      basemap: {
        type: 'vector',
        url: `pmtiles://${window.location.origin}${TILES_URL}`,
        attribution: '© OpenStreetMap contributors',
      },
    },
    layers: [
      { id: 'bg', type: 'background', paint: { 'background-color': bg } },
      {
        id: 'landuse',
        type: 'fill',
        source: 'basemap',
        'source-layer': 'landuse',
        paint: { 'fill-color': css('--theme-map-park'), 'fill-opacity': 0.7 },
      },
      {
        id: 'water',
        type: 'fill',
        source: 'basemap',
        'source-layer': 'water',
        paint: { 'fill-color': css('--theme-map-water') },
      },
      {
        id: 'buildings',
        type: 'fill',
        source: 'basemap',
        'source-layer': 'buildings',
        minzoom: 14,
        paint: { 'fill-color': css('--theme-map-building'), 'fill-opacity': 0.6 },
      },
      {
        id: 'roads',
        type: 'line',
        source: 'basemap',
        'source-layer': 'roads',
        paint: {
          'line-color': css('--theme-map-road'),
          'line-width': ['interpolate', ['linear'], ['zoom'], 10, 0.5, 15, 5, 18, 14],
        },
      },
      {
        id: 'places',
        type: 'symbol',
        source: 'basemap',
        'source-layer': 'places',
        layout: { 'text-field': ['get', 'name'], 'text-font': [GLYPH_FONT], 'text-size': 12 },
        paint: { 'text-color': text, 'text-halo-color': bg, 'text-halo-width': 1.5 },
      },
    ],
  };
}

export const createMapLibre: CreateMap = async (host, { centre, zoom }, events) => {
  // A missing tile file (or an SPA fallback page, or a blocked request) fails the header read: say so up front.
  await new PMTiles(`${window.location.origin}${TILES_URL}`).getHeader();
  ensureProtocol();

  const m = new MapLibreMap({
    container: host,
    style: buildStyle(),
    center: [centre.lng, centre.lat],
    zoom,
    minZoom: MIN_ZOOM,
    maxZoom: MAX_ZOOM,
    maxBounds: [
      [COVERAGE.west - PAD, COVERAGE.south - PAD],
      [COVERAGE.east + PAD, COVERAGE.north + PAD],
    ],
    dragRotate: false,
    pitchWithRotate: false,
    touchPitch: false,
    keyboard: true, // arrows pan, plus and minus zoom
    attributionControl: false, // a plain link is rendered by the UI
  });
  m.touchZoomRotate.disableRotation();
  m.on('error', () => undefined); // missing glyphs or one lost tile must never break the picker

  const centreOf = () => {
    const c = m.getCenter();
    return { lat: c.lat, lng: c.lng };
  };
  // MapLibre follows container size changes itself and reports them as movestart, move, resize, moveend in one
  // synchronous burst. That is not the user moving the map (and the address card changes height, which would loop):
  // collect each burst and drop it when it contained a resize.
  let burst: Array<() => void> = [];
  let resized = false;
  const push = (fn: () => void) => {
    burst.push(fn);
    if (burst.length > 1) return;
    queueMicrotask(() => {
      const run = burst;
      const drop = resized;
      burst = [];
      resized = false;
      if (!drop) for (const f of run) f();
    });
  };
  m.on('resize', () => {
    resized = true;
  });
  m.on('movestart', () => push(events.onMoveStart));
  m.on('move', () => push(() => events.onMove(centreOf())));
  m.on('moveend', () => push(() => events.onMoveEnd(centreOf())));
  m.on('load', events.onReady);

  return {
    getCenter: centreOf,
    jumpTo: (p, z) => m.jumpTo({ center: [p.lng, p.lat], ...(z === undefined ? {} : { zoom: z }) }),
    zoomBy: (delta, animate) => {
      const target = m.getZoom() + delta;
      if (animate) m.zoomTo(target, { duration: 250 });
      else m.jumpTo({ zoom: target });
    },
    resize: () => m.resize(),
    destroy: () => m.remove(),
  };
};
