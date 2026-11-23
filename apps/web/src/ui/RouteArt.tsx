import { useMemo, useRef } from 'react';
import { useSize } from '@/lib/useSize';
import { roadLayout } from '@/motion/geometry';
import { RouteOverlay } from './RouteOverlay';

/**
 * Decorative night-map plate with one lit route that follows a fictional road (straight runs, rounded turns, side
 * streets): the Find hero. No tiles, no MapLibre (nothing to download): a quiet street grid in the `map-road` role and
 * the same RouteOverlay as the real map, which receives the road as plain path data. The route draws in once per
 * session (`onceKey`), after that only the ambient light moves. Purely decorative (`aria-hidden`).
 */
export function RouteArt({ onceKey }: { onceKey: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const { w, h } = useSize(ref);
  // The road lives on a fixed grid and is fitted with one uniform scale into the area clear of the headline (top left)
  // and of the form card that overlaps the bottom edge. The box height comes from the hero, so nothing shifts.
  const road = useMemo(() => roadLayout(w, h), [w, h]);
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
            data-testid="hero-streets"
          >
            {road.streets.map((d) => (
              <path key={d} d={d} />
            ))}
          </svg>
          <RouteOverlay
            path={road.route}
            width={w}
            height={h}
            start={road.start}
            end={road.end}
            onceKey={onceKey}
          />
        </>
      )}
    </div>
  );
}
