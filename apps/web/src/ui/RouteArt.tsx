import { useEffect, useMemo, useRef } from 'react';
import { useSize } from '@/lib/useSize';
import { useReducedMotion } from '@/lib/prefs';
import { ease, loop, ms, reduced, run, sample, translate, watch, type Pt } from '@/motion/core';
import { heroScene, LAYER_BLEED, roadLayout } from '@/motion/geometry';
import { RouteOverlay } from './RouteOverlay';
import { useParallax } from './hero/useParallax';

const played = new Set<string>();
const sk = (x: number) => `translateX(${x}%) skewX(-14deg)`;
/** Ambient traffic: which path, which way, how long one trip takes (x the pulse), when it starts. */
const TRAFFIC = [
  { lane: 'route', rev: true, speed: 1.9, delay: 1.1, peak: 0.7 },
  { lane: 'route', rev: false, speed: 2.7, delay: 2.6, peak: 0.45 },
  { lane: '0', rev: false, speed: 1.5, delay: 0.5, peak: 0.8 },
  { lane: '1', rev: false, speed: 2.2, delay: 1.9, peak: 0.6 },
] as const;

/**
 * The Find hero: a decorative night-city plate (inline SVG + WAAPI, no tiles, no canvas, nothing to download). Three
 * street layers at different depths drift with the finger or tilt; one lit route (RouteOverlay) draws in with an
 * afterglow while ambient lights travel it and two side streets; pins ripple; a soft sweep of light crosses the
 * headline once; distant lights twinkle. Base CSS is the finished picture, so reduced motion (OS or in-app) simply does
 * not start anything. Loops pause off screen and in a hidden tab (watch). Purely decorative (`aria-hidden`).
 */
export function RouteArt({ onceKey }: { onceKey: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const { w, h } = useSize(ref);
  const isReduced = useReducedMotion();
  // The road lives on a fixed grid and is fitted with one uniform scale into the area clear of the headline (top left)
  // and of the form card that overlaps the bottom edge. The box height comes from the hero, so nothing shifts.
  const road = useMemo(() => roadLayout(w, h), [w, h]);
  const scene = useMemo(() => heroScene(w, h), [w, h]);
  useParallax(ref, w > 0);

  useEffect(() => {
    const el = ref.current;
    if (!el || !w) return;
    const q = (s: string) => el.querySelector<HTMLElement | SVGElement>(s);
    const route = q('.rt.core') as SVGGeometryElement | null;
    if (!route) return;
    const lane = (k: string) =>
      k === 'route' ? route : (q(`[data-lane="${k}"]`) as SVGGeometryElement | null);
    const lights = [...el.querySelectorAll<HTMLElement>('.tl')];
    const paths = TRAFFIC.map((t) => {
      const p = lane(t.lane);
      const pts = p ? sample(p, 40) : [];
      return t.rev ? pts.reverse() : pts;
    });
    // Reduced motion: the lights rest at a fixed spot (CSS shows them); with motion they are driven below.
    lights.forEach((l, i) => {
      const pt = paths[i]?.[8 + i * 7];
      if (pt) l.style.transform = translate(pt);
    });
    if (reduced()) return;

    const anims: Array<Animation | null> = [];
    const first = !played.has(onceKey);
    played.add(onceKey);
    const D = ms('draw');
    const P = ms('pulse');
    const T0 = ms('instant') * 1.25; // the overlay starts its line after the same beat
    const tEnd = first ? T0 + D : 0;
    const fade = (a: number, b: number) => [{ opacity: a }, { opacity: b }];

    lights.forEach((l, i) => {
      const t = TRAFFIC[i];
      const pts = paths[i];
      if (t && pts?.length)
        anims.push(
          loop(l, pts, { duration: P * t.speed, delay: tEnd + P * t.delay * 0.4, peak: t.peak }),
        );
    });
    // Distant lights twinkle out of step.
    el.querySelectorAll<SVGElement>('.tw').forEach((g, i) =>
      anims.push(
        run(g, fade(0.25, 1), {
          duration: P * (0.7 + i * 0.45),
          iterations: Infinity,
          direction: 'alternate',
          easing: 'ease-in-out',
          fill: 'both',
        }),
      ),
    );
    if (first) {
      // Arrival: afterglow flashes along the whole route, rings ripple where the pins land, light sweeps the headline.
      const ag = q('.ag');
      if (ag)
        anims.push(
          run(ag, [{ opacity: 0 }, { opacity: 0.9, offset: 0.15 }, { opacity: 0 }], {
            duration: ms('reveal') * 2,
            delay: tEnd,
            easing: 'ease-out',
          }),
        );
      const ripple = (sel: string, delay: number) => {
        const r = q(sel);
        if (r)
          anims.push(
            run(
              r,
              [
                { transform: 'scale(0.6)', opacity: 0.9 },
                { transform: 'scale(3.4)', opacity: 0 },
              ],
              { duration: ms('reveal'), delay, easing: ease('standard') },
            ),
          );
      };
      ripple('.rp.pk', ms('instant'));
      ripple('.rp.dp', T0 + D * 0.45 + ms('instant'));
      const sw = q('.hero-sweep');
      if (sw)
        anims.push(
          run(
            sw,
            [
              { transform: sk(-110), opacity: 0 },
              { opacity: 1, offset: 0.25 },
              { opacity: 1, offset: 0.7 },
              { transform: sk(300), opacity: 0 },
            ],
            { duration: D * 1.8, delay: ms('moderate'), easing: ease('standard') },
          ),
        );
    }
    const unwatch = watch(el);
    return () => {
      unwatch();
      anims.forEach((a) => a?.cancel());
    };
  }, [w, h, road, onceKey, isReduced]);

  const m = LAYER_BLEED;
  const bleed = {
    viewBox: `${-m} ${-m} ${w + 2 * m} ${h + 2 * m}`,
    width: w + 2 * m,
    height: h + 2 * m,
  };
  const dots = (pts: Pt[]) =>
    pts.map((p, i) => <circle key={i} cx={p.x} cy={p.y} r={i % 3 ? 1.1 : 1.6} />);
  return (
    <div ref={ref} className="hero-art" aria-hidden="true">
      {w > 0 && (
        <>
          <div className="hp" data-depth="0.4">
            <svg className="hp-far" {...bleed} focusable="false">
              <path d={scene.grid} transform={`rotate(-9 ${w / 2} ${h / 2})`} />
              <g className="tw">{dots(scene.lights[0])}</g>
              <g className="tw">{dots(scene.lights[1])}</g>
            </svg>
          </div>
          <div className="hp" data-depth="1">
            <svg
              className="map-plain hp-mid"
              {...bleed}
              focusable="false"
              data-testid="hero-streets"
            >
              {road.streets.map((d) => (
                <path key={d} d={d} />
              ))}
              {road.lanes.map((d, i) => (
                <path key={d} d={d} className="lane" data-lane={i} />
              ))}
            </svg>
            <svg className="hp-fx" {...bleed} focusable="false">
              <path className="ag" d={road.route} />
              <circle className="rp pk" cx={road.start.x} cy={road.start.y} r="10" />
              <circle className="rp dp" cx={road.end.x} cy={road.end.y} r="10" />
            </svg>
            <RouteOverlay
              path={road.route}
              width={w}
              height={h}
              start={road.start}
              end={road.end}
              onceKey={onceKey}
            />
            <div className="hp-lights">
              {TRAFFIC.map((t, i) => (
                <i key={i} className="tl" />
              ))}
            </div>
          </div>
          <div className="hp" data-depth="2">
            <svg className="hp-near" {...bleed} focusable="false">
              {scene.near.map((d) => (
                <path key={d} d={d} />
              ))}
              {scene.bokeh.map((b, i) => (
                <circle key={i} cx={b.x} cy={b.y} r={b.r} />
              ))}
            </svg>
          </div>
          <i className="hero-sweep" />
        </>
      )}
    </div>
  );
}
