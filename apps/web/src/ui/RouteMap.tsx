import { Map as MapLibreMap, addProtocol, type StyleSpecification } from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import { PMTiles, Protocol } from 'pmtiles';
import { useEffect, useRef, useState } from 'react';
import type { LatLng } from '@/api/types';
import { t } from '@/i18n';
import { useSize } from '@/lib/useSize';
import { dist, ease, ms, reduced, run, settle, type Pt } from '@/motion/core';
import { curvePath, plainEndpoints, plainStreets, smoothPath } from '@/motion/geometry';
import { MiniLoader } from './Loader';
import { RouteOverlay } from './RouteOverlay';

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
  /** The passenger's own start and end (match moment): their walks snap onto the ride. Client-side only. */
  you?: { from: LatLng; to: LatLng };
  /** Extra exact points on the route (the driver's confirmed passengers, 4.5). Only drawn over real tiles. */
  pins?: LatLng[];
  /** Chip text for the match moment ("Fits your route. 150 m walk to pickup."). A sibling of the map, so it is in the accessibility tree. */
  fit?: string;
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

/**
 * Minimal Protomaps-schema style in the `map-*` theme roles (no hard-coded colours). The route itself is not a map
 * layer: it is the RouteOverlay above the canvas (design-direction section 6).
 */
function buildStyle(): StyleSpecification {
  const bg = css('--theme-map-bg');
  const water = css('--theme-map-water');
  const park = css('--theme-map-park');
  const road = css('--theme-map-road');
  const building = css('--theme-map-building');
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

/** Pixel radius of `radiusM` metres around a point at the current zoom. */
function radiusPx(m: MapLibreMap, c: LatLng, radiusM: number): number {
  const dLng = radiusM / (111_320 * Math.cos((c.lat * Math.PI) / 180));
  const a = m.project([c.lng, c.lat]);
  const b = m.project([c.lng + dLng, c.lat]);
  return Math.abs(b.x - a.x);
}

interface Geometry {
  path: string;
  start: Pt;
  end: Pt;
  zones: number | undefined;
  you?: { from: Pt; to: Pt } | undefined;
  pins?: Pt[] | undefined;
}

/**
 * Lazy route map (architecture section 11): MapLibre on a self-hosted PMTiles file, locked to Sibiu, with the glowing
 * route as an SVG overlay (moment 1). Always paired with a text description (accessibility.md open item 2). If the tile
 * file is missing or unreadable the same overlay draws over the plain `map-bg` background with a note, and the text
 * description still tells the whole story. Import through React.lazy so Find and Results never download MapLibre.
 */
export default function RouteMap({
  mode,
  pickup,
  dropoff,
  route,
  you,
  pins,
  fit,
  description,
  className = '',
}: RouteMapProps) {
  const host = useRef<HTMLDivElement>(null);
  const frame = useRef<HTMLDivElement>(null);
  const [phase, setPhase] = useState<Phase>('loading');
  const [projected, setProjected] = useState<Geometry | null>(null);
  const { w, h } = useSize(frame);
  const pinsKey = (pins ?? []).map((p) => `${p.lat},${p.lng}`).join('|');

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
          [
            Math.min(pickup.lng, dropoff.lng, you?.from.lng ?? Infinity, you?.to.lng ?? Infinity),
            Math.min(pickup.lat, dropoff.lat, you?.from.lat ?? Infinity, you?.to.lat ?? Infinity),
          ],
          [
            Math.max(pickup.lng, dropoff.lng, you?.from.lng ?? -Infinity, you?.to.lng ?? -Infinity),
            Math.max(pickup.lat, dropoff.lat, you?.from.lat ?? -Infinity, you?.to.lat ?? -Infinity),
          ],
        ],
        fitBoundsOptions: { padding: 48, maxZoom: 15 },
        maxZoom: 15,
        dragRotate: false,
        pitchWithRotate: false,
        touchPitch: false,
        keyboard: false, // the canvas is decorative for assistive tech: the text alternative carries the content
        cooperativeGestures: true,
        attributionControl: false, // rendered below as a plain link, outside the aria-hidden canvas
      });
      map = m;
      m.touchZoomRotate.disableRotation();
      m.getCanvas().removeAttribute('tabindex'); // the canvas must not be a keyboard stop

      m.on('error', () => undefined); // missing glyphs/tiles must never break the page
      // Re-project the route whenever the view changes (rare: the map is static under cooperative gestures).
      const reproject = () => {
        if (cancelled) return;
        const toPt = (c: LatLng): Pt => {
          const p = m.project([c.lng, c.lat]);
          return { x: p.x, y: p.y };
        };
        const start = toPt(pickup);
        const end = toPt(dropoff);
        const pts = route && route.length > 1 ? route.map(([lng, lat]) => toPt({ lat, lng })) : [];
        setProjected({
          path: pts.length > 1 ? smoothPath(pts) : curvePath(start, end),
          start,
          end,
          zones: mode === 'approximate' ? radiusPx(m, pickup, APPROX_RADIUS_M) : undefined,
          you: you ? { from: toPt(you.from), to: toPt(you.to) } : undefined,
          pins: pins && pins.length > 0 ? pins.map(toPt) : undefined,
        });
      };
      m.on('load', () => {
        reproject();
        if (!cancelled) setPhase('ready');
      });
      m.on('moveend', reproject);
      m.on('resize', reproject);
    })();

    return () => {
      cancelled = true;
      map?.remove();
    };
  }, [
    mode,
    pickup.lat,
    pickup.lng,
    dropoff.lat,
    dropoff.lng,
    route,
    you?.from.lat,
    you?.from.lng,
    you?.to.lat,
    you?.to.lng,
    pinsKey,
  ]);

  // Plain background: a fixed layout in the measured box, same overlay.
  const plain = phase === 'unavailable' && w > 0 && h > 0 ? plainEndpoints(w, h) : null;
  const geom: Geometry | null =
    phase === 'ready'
      ? projected
      : plain
        ? {
            path: curvePath(plain.start, plain.end),
            start: plain.start,
            end: plain.end,
            zones: mode === 'approximate' ? Math.min(w, h) * 0.12 : undefined,
            you: you
              ? {
                  from: { x: plain.start.x - w * 0.1, y: plain.start.y - h * 0.2 },
                  to: { x: plain.end.x + w * 0.1, y: plain.end.y + h * 0.2 },
                }
              : undefined,
          }
        : null;

  // Match chip: springs in after the snap; sits in the corner away from the start marker.
  const chip = useRef<HTMLParagraphElement>(null);
  const chipOn = Boolean(fit && geom);
  useEffect(() => {
    const el = chip.current;
    if (!el || !chipOn || reduced()) return;
    const a = run(
      el,
      [
        { opacity: 0, transform: `translateY(${dist('rise')})` },
        { opacity: 1, transform: 'none' },
      ],
      {
        duration: ms('slow'),
        delay: ms('reveal') + settle() + ms('instant'),
        easing: ease('spring'),
      },
    );
    return () => a?.cancel();
  }, [chipOn]);

  const label = t(mode === 'approximate' ? 'a11y.map.approx' : 'a11y.map.exact');

  return (
    <figure className={`m-0 flex flex-col gap-2 ${className}`}>
      <div className="relative">
        <div ref={frame} className="map-frame" role="group" aria-label={label}>
          {phase !== 'unavailable' && <div ref={host} className="size-full" aria-hidden="true" />}
          {phase === 'unavailable' && w > 0 && (
            <svg
              className="map-plain"
              viewBox={`0 0 ${w} ${h}`}
              width={w}
              height={h}
              aria-hidden="true"
              focusable="false"
            >
              {plainStreets(w, h).map((d) => (
                <path key={d} d={d} />
              ))}
            </svg>
          )}
          {geom && <RouteOverlay {...geom} width={w} height={h} />}
          {phase === 'loading' && (
            <div role="status" className="absolute inset-0 grid place-items-center">
              <MiniLoader label={t('map.loading')} />
            </div>
          )}
          {phase !== 'unavailable' && (
            <a
              className="map-attribution glass"
              href="https://www.openstreetmap.org/copyright"
              target="_blank"
              rel="noopener noreferrer"
            >
              {t('map.attribution')}
            </a>
          )}
          {phase === 'unavailable' && <p className="map-note glass">{t('map.unavailable')}</p>}
        </div>
        {fit && geom && (
          <p
            ref={chip}
            className={`match-chip glass ${phase === 'unavailable' ? 'under' : geom.start.y > h / 2 ? 'top' : 'bottom'}`}
          >
            {fit}
          </p>
        )}
      </div>
      <figcaption className="text-sm leading-5 text-text-muted">
        <span className="font-semibold">
          {t(mode === 'approximate' ? 'common.approx' : 'common.exact')}.
        </span>{' '}
        {description}
      </figcaption>
    </figure>
  );
}
