import { useLayoutEffect, useRef } from 'react';
import { ease, ms, ride, run, sample, scale, stop, type Pt } from '@/motion/core';
import { roundedPath } from '@/motion/geometry';

const INSET = 18; // distance of the pickup and drop-off dots from the card edge
const TURN = 6; // turn radius of the miniature road
const LIGHT = 10; // headlight and dot size in px (matches .rl-dot in motion.css)

/** The little road along the bottom edge of a card: pickup low left, one jog up and down, drop-off right. */
export function miniRoad(w: number, h: number): { d: string; start: Pt; end: Pt } {
  const low = h - 9;
  const high = h - 15;
  const pts: Pt[] = [
    { x: INSET, y: low },
    { x: w * 0.4, y: low },
    { x: w * 0.4, y: high },
    { x: w * 0.7, y: high },
    { x: w * 0.7, y: low },
    { x: w - INSET, y: low },
  ];
  return { d: roundedPath(pts, TURN), start: pts[0]!, end: pts[pts.length - 1]! };
}

/**
 * The signature moment of a popular route tap (decoration only, aria-hidden): the road draws from the pickup dot to the
 * drop-off dot (stroke-dashoffset, the documented exception), the headlight rides it (transform only), the dots pulse
 * (transform only). All timings and easings come from the --tk-* tokens. Never rendered with reduced motion.
 */
export function RouteLaunch({ w, h }: { w: number; h: number }) {
  const root = useRef<HTMLSpanElement>(null);
  const path = useRef<SVGPathElement>(null);
  const light = useRef<HTMLSpanElement>(null);
  const from = useRef<HTMLSpanElement>(null);
  const to = useRef<HTMLSpanElement>(null);
  const road = miniRoad(w, h);

  useLayoutEffect(() => {
    const el = root.current;
    const p = path.current;
    if (!el || !p || !light.current || !from.current || !to.current) return;
    if (typeof p.getTotalLength !== 'function') return; // no SVG geometry (tests): the static picked state remains
    const len = p.getTotalLength();
    const draw = ms('slow');
    const delay = ms('instant');
    const pop = scale('pop');
    p.style.strokeDasharray = `${len}`;
    run(p, [{ strokeDashoffset: len }, { strokeDashoffset: 0 }], {
      duration: draw,
      delay,
      easing: ease('momentum'),
      fill: 'both',
    });
    const half = LIGHT / 2;
    const pts = sample(p, 40).map((q) => ({ x: q.x - half, y: q.y - half }));
    ride(light.current, pts, { duration: draw, delay, easing: ease('momentum') });
    run(
      from.current,
      [
        { transform: 'scale(1)' },
        { transform: `scale(${pop})`, offset: 0.3 },
        { transform: 'scale(1)' },
      ],
      { duration: ms('moderate'), easing: ease('standard') },
    );
    run(
      to.current,
      [
        { transform: 'scale(1)' },
        { transform: `scale(${pop})`, offset: 0.4 },
        { transform: 'scale(1)' },
      ],
      { duration: ms('moderate'), delay: delay + draw, easing: ease('standard') },
    );
    return () => stop(el);
  }, [w, h]);

  return (
    <span ref={root} className="rl" aria-hidden="true" data-testid="route-launch">
      <svg className="rl-svg" width={w} height={h} viewBox={`0 0 ${w} ${h}`} focusable="false">
        <path ref={path} className="rl-road" d={road.d} />
      </svg>
      <span
        ref={from}
        className="rl-dot"
        style={{ left: road.start.x - LIGHT / 2, top: road.start.y - LIGHT / 2 }}
      />
      <span
        ref={to}
        className="rl-dot"
        style={{ left: road.end.x - LIGHT / 2, top: road.end.y - LIGHT / 2 }}
      />
      <span ref={light} className="rl-light" />
    </span>
  );
}
