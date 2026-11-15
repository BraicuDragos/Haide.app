/**
 * Motion helpers (ADR 0019, docs/ux/motion.md): CSS custom properties for every duration and easing, the Web
 * Animations API for the rest. No animation library. Rules:
 *  - animate transform and opacity only (the one exception is the one-shot route draw-in, stroke-dashoffset);
 *  - never type a duration or easing here: they are read from the --tk-* tokens;
 *  - the base CSS is the calm final state, so "reduced motion" simply means "do not start the animation";
 *  - endless loops pause while off screen and while the tab is hidden.
 */
import { reducedMotion } from '@/lib/prefs';

export { reducedMotion as reduced };

const root = () => document.documentElement;
const css = (name: string) => getComputedStyle(root()).getPropertyValue(name).trim();

/** Duration token in ms: `ms('slow')` reads --tk-dur-slow. */
export const ms = (name: string): number => toMs(css(`--tk-dur-${name}`));
/** The build minifier may rewrite 400ms as .4s, so read the unit. */
export function toMs(v: string): number {
  const n = parseFloat(v);
  if (Number.isNaN(n)) return 0;
  return /[0-9.]s$/.test(v.trim()) ? n * 1000 : n;
}
/** Easing token: `ease('spring')` reads --tk-ease-spring (a linear() curve where supported). */
export const ease = (name: string): string => css(`--tk-ease-${name}`) || 'ease';
/** Travel distance token as a CSS length, e.g. `dist('rise')` is 12px. */
export const dist = (name: string): string => css(`--tk-travel-${name}`) || '0px';
export const scale = (name: string): string => css(`--tk-scale-${name}`) || '1';
/** Stagger delay for item i, capped (tokens stagger.step and stagger.max). */
export const stagger = (i: number): number =>
  Math.min(
    Math.max(i, 0) * (parseFloat(css('--tk-stagger-step')) || 0),
    parseFloat(css('--tk-stagger-max')) || 0,
  );
/** The magnet spring's natural settle time (token motion.duration.settle). */
export const settle = (): number => ms('settle');

type Kf = Keyframe[] | PropertyIndexedKeyframes;

/** WAAPI with `fill: backwards`, so the element is back at its CSS state when the animation ends. */
export function run(
  el: Element,
  keyframes: Kf,
  options: KeyframeAnimationOptions,
): Animation | null {
  if (reducedMotion() || typeof el.animate !== 'function') return null;
  return el.animate(keyframes, { fill: 'backwards', ...options });
}

/** Cancels every animation under `el` (used on unmount so nothing runs on a detached tree). */
export function stop(el: Element | null) {
  el?.getAnimations({ subtree: true }).forEach((a) => a.cancel());
}

export interface Pt {
  x: number;
  y: number;
}
/** Samples a path into points: the travelling light is an HTML element moved with transform, not an SVG animation. */
export function sample(path: SVGGeometryElement, n = 48): Pt[] {
  const len = path.getTotalLength();
  return Array.from({ length: n + 1 }, (_, i) => {
    const p = path.getPointAtLength((len * i) / n);
    return { x: p.x, y: p.y };
  });
}
export const translate = (p: Pt) => `translate(${p.x.toFixed(1)}px, ${p.y.toFixed(1)}px)`;

/** Light travels the points once. */
export const ride = (el: Element, pts: Pt[], o: KeyframeAnimationOptions) =>
  run(
    el,
    pts.map((p) => ({ transform: translate(p) })),
    { fill: 'both', ...o },
  );

/** Ambient pulse: travels for 62% of the cycle (sine-eased along the path), then rests. */
export function loop(
  el: Element,
  pts: Pt[],
  o: { duration: number; delay?: number; peak?: number },
): Animation | null {
  const n = pts.length - 1;
  const span = 0.62;
  const peak = o.peak ?? 1;
  const at = (u: number): Pt => {
    const f = (0.5 - 0.5 * Math.cos(Math.PI * u)) * n;
    const i = Math.min(Math.floor(f), n - 1);
    const k = f - i;
    const a = pts[i]!;
    const b = pts[i + 1]!;
    return { x: a.x + (b.x - a.x) * k, y: a.y + (b.y - a.y) * k };
  };
  const kf: Keyframe[] = pts.map((_, i) => ({
    offset: (i / n) * span,
    transform: translate(at(i / n)),
    opacity: peak * Math.min(1, i / 6, (n - i) / 6),
  }));
  kf.push({ offset: 1, transform: translate(pts[n]!), opacity: 0 });
  return run(el, kf, {
    duration: o.duration,
    delay: o.delay ?? 0,
    iterations: Infinity,
    easing: 'linear',
    fill: 'both',
  });
}

/* ---- loops pause off screen and while the tab is hidden ---- */
const isLoop = (a: Animation) => a.effect?.getComputedTiming().iterations === Infinity;
const visible = new WeakSet<Element>();
const watched = new Set<Element>();
let observer: IntersectionObserver | null = null;
let hiddenListener = false;

const setLoops = (el: Element, play: boolean) =>
  el
    .getAnimations({ subtree: true })
    .filter(isLoop)
    .forEach((a) => (play ? a.play() : a.pause()));

/** Pause the endless animations under `el` whenever it is off screen or the tab is hidden. Returns an unwatch fn. */
export function watch(el: Element): () => void {
  if (typeof IntersectionObserver === 'undefined') return () => undefined;
  observer ??= new IntersectionObserver(
    (entries) =>
      entries.forEach((e) => {
        if (e.isIntersecting) visible.add(e.target);
        else visible.delete(e.target);
        setLoops(e.target, e.isIntersecting && !document.hidden);
      }),
    { threshold: 0.2 },
  );
  if (!hiddenListener) {
    hiddenListener = true;
    document.addEventListener('visibilitychange', () =>
      watched.forEach((w) => setLoops(w, !document.hidden && visible.has(w))),
    );
  }
  watched.add(el);
  observer.observe(el);
  return () => {
    watched.delete(el);
    visible.delete(el);
    observer?.unobserve(el);
  };
}

/** Entrance: rise and fade, staggered (first 8 elements marked data-enter inside `rootEl`). */
export function enter(rootEl: ParentNode, delay = 0) {
  if (reducedMotion()) return;
  [...rootEl.querySelectorAll('[data-enter]')].slice(0, 8).forEach((el, i) =>
    run(
      el,
      [
        { opacity: 0, transform: `translateY(${dist('rise')})` },
        { opacity: 1, transform: 'none' },
      ],
      {
        duration: ms('moderate'),
        delay: delay + stagger(i),
        easing: ease('enter'),
      },
    ),
  );
}
