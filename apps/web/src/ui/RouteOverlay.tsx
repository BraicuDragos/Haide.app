import { useEffect, useRef } from 'react';
import {
  ease,
  loop,
  ms,
  reduced,
  ride,
  run,
  sample,
  settle,
  translate,
  watch,
  type Pt,
} from '@/motion/core';
import { useReducedMotion } from '@/lib/prefs';

export interface RouteOverlayProps {
  /** SVG path data in the box's pixel space. */
  path: string;
  width: number;
  height: number;
  start: Pt;
  end: Pt;
  /** Approximate mode: pickup and drop-off areas, radius in px. */
  zones?: number | undefined;
  /** Match moment (motion.md 2): where the passenger starts and ends, in px. The walk legs snap onto the ride. */
  you?: { from: Pt; to: Pt } | undefined;
  /** Play the draw-in (once per mount, or once per session when `onceKey` is given). */
  draw?: boolean;
  onceKey?: string;
}

const drawn = new Set<string>();

/**
 * The glowing saffron route (moment 1, docs/ux/motion.md): stacked strokes (aura, halo, core, spark, no blur filter)
 * in an SVG above the map, plus an HTML layer for the travelling light that moves with `transform` (compositor only).
 * Purely decorative (`aria-hidden`): the text description next to the map carries the content. Works on a plain
 * background as well as over tiles. Reduced motion: the route is fully drawn, one still light mid-route, no loops.
 */
export function RouteOverlay({
  path,
  width,
  height,
  start,
  end,
  zones,
  you,
  draw = true,
  onceKey,
}: RouteOverlayProps) {
  const wrap = useRef<HTMLDivElement>(null);
  const core = useRef<SVGPathElement>(null);
  const isReduced = useReducedMotion();
  const matched = useRef(false);
  const ready = Boolean(width && height && path);
  const hasYou = Boolean(you);

  // Match (moment 2): the passenger's walks arrive slightly off and rotated, then snap on with a magnetic overshoot,
  // rings ripple at both ends. Once per mount, after the route has started to draw. Reduced motion: already aligned.
  useEffect(() => {
    const el = wrap.current;
    if (!el || !ready || !hasYou || matched.current || reduced()) return;
    matched.current = true;
    const q = (s: string) => el.querySelector<SVGElement>(s);
    const t0 = ms('reveal');
    const anims: Array<Animation | null> = [];
    const pass = q('.pass');
    if (pass)
      anims.push(
        run(
          pass,
          [
            { transform: 'translate(-14px, 22px) rotate(-3deg)', opacity: 0.5 },
            { transform: 'none', opacity: 1 },
          ],
          { duration: settle(), delay: t0, easing: ease('magnet') },
        ),
      );
    el.querySelectorAll<SVGElement>('.snap').forEach((s) =>
      anims.push(
        run(
          s,
          [
            { transform: 'scale(0.6)', opacity: 0.9 },
            { transform: 'scale(2.4)', opacity: 0 },
          ],
          { duration: ms('slow'), delay: t0 + settle() + ms('instant'), easing: ease('standard') },
        ),
      ),
    );
    return () => anims.forEach((a) => a?.cancel());
  }, [ready, hasYou]);

  useEffect(() => {
    const el = wrap.current;
    const route = core.current;
    if (!el || !route || !width || !path) return;
    const q = (s: string) => el.querySelector<HTMLElement | SVGElement>(s);
    const all = (s: string) => [...el.querySelectorAll<HTMLElement | SVGElement>(s)];
    const pts = sample(route, 64);
    const mid = pts[32];
    const still = q('.pl.still') as HTMLElement | null;
    if (still && mid) still.style.transform = translate(mid);
    if (reduced()) return;

    const anims: Array<Animation | null> = [];
    const play = draw && !(onceKey && drawn.has(onceKey));
    if (onceKey) drawn.add(onceKey);
    const D = ms('draw');
    const P = ms('pulse');
    const T0 = ms('instant') + ms('instant') * 0.25; // a beat before the line starts
    const t0 = play ? T0 + D : 0;

    if (play) {
      all('.rt').forEach((p, i) =>
        anims.push(
          run(p, [{ strokeDashoffset: 1 }, { strokeDashoffset: 0 }], {
            duration: D,
            delay: T0 + (i % 2) * (ms('instant') * 0.4),
            easing: ease('momentum'),
          }),
        ),
      );
      const pop = (sel: string, delay: number) => {
        const m = q(sel);
        if (m)
          anims.push(
            run(m, [{ transform: 'scale(0)' }, { transform: 'scale(1)' }], {
              duration: ms('slow'),
              delay,
              easing: ease('spring'),
            }),
          );
      };
      pop('.pk .dot', 0);
      pop('.dp .t', T0 + D * 0.45);
      const ping = q('.pk .ping');
      if (ping)
        anims.push(
          run(
            ping,
            [
              { transform: 'scale(1)', opacity: 0.9 },
              { transform: 'scale(3)', opacity: 0 },
            ],
            { duration: ms('reveal'), delay: ms('instant'), easing: ease('standard') },
          ),
        );
      const head = q('.pl.hd');
      if (head) {
        anims.push(ride(head, pts, { duration: D, delay: T0, easing: ease('momentum') }));
        anims.push(
          run(
            head,
            [
              { opacity: 0 },
              { opacity: 1, offset: 0.05 },
              { opacity: 1, offset: 0.7 },
              { opacity: 0 },
            ],
            {
              duration: D,
              delay: T0,
              easing: 'linear',
              composite: 'replace',
              fill: 'both',
            },
          ),
        );
      }
    }
    // Trailing lights and one ambient head travel the path every `pulse`; the aura breathes slowly.
    all('.pl.t').forEach((t, i) =>
      anims.push(
        loop(t, pts, {
          duration: P,
          delay: t0 + ms('instant') * 0.9 * (i + 1),
          peak: [0.6, 0.35, 0.18][i] ?? 0.2,
        }),
      ),
    );
    const amb = q('.pl.amb');
    if (amb) anims.push(loop(amb, pts, { duration: P, delay: t0 }));
    const aura = q('.rt.aura');
    if (aura)
      anims.push(
        run(aura, [{ opacity: 0.7 }, { opacity: 1 }], {
          duration: P * 2,
          delay: t0,
          iterations: Infinity,
          direction: 'alternate',
          easing: 'ease-in-out',
          fill: 'both',
        }),
      );
    const unwatch = watch(el);
    return () => {
      unwatch();
      anims.forEach((a) => a?.cancel());
    };
  }, [path, width, height, draw, onceKey, isReduced]);

  if (!width || !height || !path) return null;
  return (
    <div ref={wrap} className="route-fx" aria-hidden="true">
      <svg viewBox={`0 0 ${width} ${height}`} width={width} height={height} focusable="false">
        {zones !== undefined && (
          <>
            <circle className="zone" cx={start.x} cy={start.y} r={zones} />
            <circle className="zone" cx={end.x} cy={end.y} r={zones} />
          </>
        )}
        <path className="rt aura" d={path} pathLength={1} />
        <path className="rt halo" d={path} pathLength={1} />
        <path ref={core} className="rt core" d={path} pathLength={1} />
        <path className="rt spark" d={path} pathLength={1} />
        {you && (
          <>
            <g className="pass">
              <path className="walk" d={`M${you.from.x} ${you.from.y}L${start.x} ${start.y}`} />
              <path className="walk" d={`M${end.x} ${end.y}L${you.to.x} ${you.to.y}`} />
              <circle className="you" cx={you.from.x} cy={you.from.y} r="6" />
              <circle className="you" cx={you.to.x} cy={you.to.y} r="6" />
            </g>
            <circle className="snap" cx={start.x} cy={start.y} r="10" />
            <circle className="snap" cx={end.x} cy={end.y} r="10" />
          </>
        )}
        <g className="pk" transform={`translate(${start.x} ${start.y})`}>
          <circle className="ring" r="11" />
          <circle className="ping mk" r="11" />
          <circle className="dot mk" r="7" />
        </g>
        <g className="dp" transform={`translate(${end.x} ${end.y})`}>
          <circle className="t mk" r="7" />
        </g>
      </svg>
      <div className="fx">
        <i className="pl hd" />
        <i className="pl t t1" />
        <i className="pl t t2" />
        <i className="pl t t3" />
        <i className="pl amb" />
        <i className="pl still" />
      </div>
    </div>
  );
}
