import { Map as MapLibreMap, addProtocol, type StyleSpecification } from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import { PMTiles, Protocol } from 'pmtiles';
import { useEffect, useRef, useState } from 'react';
import type { LatLng } from '@/api/types';
import { t } from '@/i18n';

/** Sibiu bounding box, same as the gazetteer and tile build: [west, south, east, north]. */
export const SIBIU_BOUNDS: [number, number, number, number] = [23.98, 45.68, 24.32, 45.86];
export const TILES_URL = '/tiles/sibiu.pmtiles';
/** Font stack name inside public/glyphs/<stack>/<range>.pbf. Must match what scripts/geo/build-tiles.sh ships. */
const GLYPH_FONT = 'Noto Sans Regular';
const APPROX_RADIUS_M = 300;

export interface RouteMapProps {
  /** approximate: pickup and drop-off are 300 m areas (privacy). exact: precise points (confirmed passengers). */
  mode: 'approximate' | 'exact';
  pickup: LatLng;
  dropoff: LatLng;
  /** Optional route geometry as [lng, lat] pairs. */
  route?: Array<[number, number]>;
  /** Text alternative: what the map shows, in words (pickup and drop-off labels). Rendered visibly under the map. */
  description: string;
  className?: string;
}

type Phase = 'loading' | 'ready' | 'unavailable';

let protocolAdded = false;
function ensureProtocol() {
  if (protocolAdded) return;
  const protocol = new Protocol();
  addProtocol('pmtiles', protocol.tile);
  protocolAdded = true;
}

const css = (name: string) =>
  getComputedStyle(document.documentElement).getPropertyValue(name).trim();

/** Minimal Protomaps-schema style, coloured from the design tokens (no hard-coded colours). */
function buildStyle(): StyleSpecification {
  const bg = css('--theme-surface-subtle');
  const water = css('--tk-color-secondary-100');
  const park = css('--tk-color-secondary-50');
  const road = css('--theme-surface');
  const roadCase = css('--theme-border');
  const building = css('--theme-border');
  const text = css('--theme-text-muted');
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
        paint: { 'fill-color': park, 'fill-opacity': 0.7 },
      },
      {
        id: 'water',
        type: 'fill',
        source: 'basemap',
        'source-layer': 'water',
        paint: { 'fill-color': water },
      },
      {
        id: 'buildings',
        type: 'fill',
        source: 'basemap',
        'source-layer': 'buildings',
        minzoom: 14,
        paint: { 'fill-color': building, 'fill-opacity': 0.6 },
      },
      {
        id: 'roads-case',
        type: 'line',
        source: 'basemap',
        'source-layer': 'roads',
        paint: {
          'line-color': roadCase,
          'line-width': ['interpolate', ['linear'], ['zoom'], 10, 1, 15, 7],
        },
      },
      {
        id: 'roads',
        type: 'line',
        source: 'basemap',
        'source-layer': 'roads',
        paint: {
          'line-color': road,
          'line-width': ['interpolate', ['linear'], ['zoom'], 10, 0.5, 15, 5],
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

/** GeoJSON polygon approximating a circle of `radiusM` around a point. */
type PolygonFeature = {
  type: 'Feature';
  properties: Record<string, never>;
  geometry: { type: 'Polygon'; coordinates: number[][][] };
};
function circle(c: LatLng, radiusM: number, steps = 48): PolygonFeature {
  const dLat = radiusM / 111_320;
  const dLng = radiusM / (111_320 * Math.cos((c.lat * Math.PI) / 180));
  const ring: Array<[number, number]> = Array.from({ length: steps + 1 }, (_, i) => {
    const a = (i / steps) * 2 * Math.PI;
    return [c.lng + dLng * Math.cos(a), c.lat + dLat * Math.sin(a)];
  });
  return { type: 'Feature', properties: {}, geometry: { type: 'Polygon', coordinates: [ring] } };
}

/**
 * Lazy route map (architecture section 11): MapLibre on a self-hosted PMTiles file, locked to Sibiu.
 * Always paired with a text description (accessibility.md open item 2). If the tile file is missing or unreadable the
 * map area degrades to a message and the text description still tells the whole story.
 * Import through React.lazy so Find and Results never download MapLibre.
 */
export default function RouteMap({
  mode,
  pickup,
  dropoff,
  route,
  description,
  className = '',
}: RouteMapProps) {
  const host = useRef<HTMLDivElement>(null);
  const [phase, setPhase] = useState<Phase>('loading');

  useEffect(() => {
    let map: MapLibreMap | undefined;
    let cancelled = false;

    (async () => {
      try {
        // Probe the tile archive first: a missing file (or an SPA fallback page) fails the header read.
        await new PMTiles(`${window.location.origin}${TILES_URL}`).getHeader();
      } catch {
        if (!cancelled) setPhase('unavailable');
        return;
      }
      if (cancelled || !host.current) return;

      ensureProtocol();
      const m = new MapLibreMap({
        container: host.current,
        style: buildStyle(),
        maxBounds: [
          [SIBIU_BOUNDS[0], SIBIU_BOUNDS[1]],
          [SIBIU_BOUNDS[2], SIBIU_BOUNDS[3]],
        ],
        bounds: [
          [Math.min(pickup.lng, dropoff.lng), Math.min(pickup.lat, dropoff.lat)],
          [Math.max(pickup.lng, dropoff.lng), Math.max(pickup.lat, dropoff.lat)],
        ],
        fitBoundsOptions: { padding: 48, maxZoom: 15 },
        maxZoom: 15,
        dragRotate: false,
        pitchWithRotate: false,
        touchPitch: false,
        keyboard: false, // the canvas is decorative for assistive tech: the text alternative carries the content
        cooperativeGestures: true,
        attributionControl: { compact: true },
      });
      map = m;
      m.touchZoomRotate.disableRotation();

      m.on('error', () => undefined); // missing glyphs/tiles must never break the page
      m.on('load', () => {
        const primary = css('--theme-action');
        const accent = css('--theme-accent');
        const surface = css('--theme-surface');
        const dark = css('--tk-color-primary-700');

        if (route && route.length > 1) {
          m.addSource('route', {
            type: 'geojson',
            data: {
              type: 'Feature',
              properties: {},
              geometry: { type: 'LineString', coordinates: route },
            },
          });
          m.addLayer({
            id: 'route',
            type: 'line',
            source: 'route',
            layout: { 'line-cap': 'round', 'line-join': 'round' },
            paint: { 'line-color': dark, 'line-width': 4 },
          });
        }
        if (mode === 'approximate') {
          m.addSource('areas', {
            type: 'geojson',
            data: {
              type: 'FeatureCollection',
              features: [circle(pickup, APPROX_RADIUS_M), circle(dropoff, APPROX_RADIUS_M)],
            },
          });
          m.addLayer({
            id: 'areas-fill',
            type: 'fill',
            source: 'areas',
            paint: { 'fill-color': primary, 'fill-opacity': 0.18 },
          });
          m.addLayer({
            id: 'areas-line',
            type: 'line',
            source: 'areas',
            paint: { 'line-color': dark, 'line-width': 2, 'line-dasharray': [2, 2] },
          });
        } else {
          m.addSource('points', {
            type: 'geojson',
            data: {
              type: 'FeatureCollection',
              features: [
                {
                  type: 'Feature',
                  properties: { kind: 'pickup' },
                  geometry: { type: 'Point', coordinates: [pickup.lng, pickup.lat] },
                },
                {
                  type: 'Feature',
                  properties: { kind: 'dropoff' },
                  geometry: { type: 'Point', coordinates: [dropoff.lng, dropoff.lat] },
                },
              ],
            },
          });
          m.addLayer({
            id: 'points',
            type: 'circle',
            source: 'points',
            paint: {
              'circle-radius': 8,
              'circle-color': ['match', ['get', 'kind'], 'pickup', accent, surface],
              'circle-stroke-color': dark,
              'circle-stroke-width': 3,
            },
          });
        }
        if (!cancelled) setPhase('ready');
      });
    })();

    return () => {
      cancelled = true;
      map?.remove();
    };
  }, [mode, pickup.lat, pickup.lng, dropoff.lat, dropoff.lng, route]);

  const label = t(mode === 'approximate' ? 'a11y.map.approx' : 'a11y.map.exact');

  return (
    <figure className={`m-0 flex flex-col gap-2 ${className}`}>
      {phase === 'unavailable' ? (
        <div
          className="grid h-52 place-items-center rounded-md border border-border bg-surface-subtle p-4 text-center text-text-muted"
          role="img"
          aria-label={label}
        >
          <p>{t('map.unavailable')}</p>
        </div>
      ) : (
        <div className="relative h-52 overflow-hidden rounded-md border border-border bg-surface-subtle">
          <div ref={host} role="img" aria-label={label} className="size-full" />
          {phase === 'loading' && (
            <p
              role="status"
              className="absolute inset-0 grid place-items-center text-sm text-text-muted"
            >
              {t('map.loading')}
            </p>
          )}
        </div>
      )}
      <figcaption className="text-sm leading-5 text-text-muted">
        <span className="font-semibold">
          {t(mode === 'approximate' ? 'common.approx' : 'common.exact')}.
        </span>{' '}
        {description}
      </figcaption>
    </figure>
  );
}
