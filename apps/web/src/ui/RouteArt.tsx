import { useRef } from 'react';
import { useSize } from '@/lib/useSize';
import { curvePath, plainStreets } from '@/motion/geometry';
import { RouteOverlay } from './RouteOverlay';

/**
 * Decorative night-map plate with one lit route: the Find hero. No tiles, no MapLibre (nothing to download): quiet
 * street lines in the `map-road` role and the same RouteOverlay as the real map. The route draws in once per session
 * (`onceKey`), after that only the ambient light moves. Purely decorative (`aria-hidden`).
 */
export function RouteArt({ onceKey }: { onceKey: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const { w, h } = useSize(ref);
  // Keep the route clear of the headline (top left) and of the form card that overlaps the bottom edge.
  const start = { x: w * 0.1, y: h * 0.8 };
  const end = { x: w * 0.9, y: h * 0.6 };
  return (
    <div ref={ref} className="hero-art" aria-hidden="true">
      {w > 0 && (
        <>
          <svg
            className="map-plain"
            viewBox={`0 0 ${w} ${h}`}
            width={w}
            height={h}
            focusable="false"
          >
            {plainStreets(w, h).map((d) => (
              <path key={d} d={d} />
            ))}
          </svg>
          <RouteOverlay
            path={curvePath(start, end)}
            width={w}
            height={h}
            start={start}
            end={end}
            onceKey={onceKey}
          />
        </>
      )}
    </div>
  );
}
