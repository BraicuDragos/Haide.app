import { useEffect, useRef } from 'react';
import { loop, ms, reduced, sample, translate, watch, type Pt } from '@/motion/core';
import { useReducedMotion } from '@/lib/prefs';
import { t } from '@/i18n';

/** The tiny route the light travels (160 x 70). Shared by the loader and the empty state. */
export const TINY_ROUTE = 'M12 58C48 58 52 22 84 22S124 38 148 12';

/** One light on a tiny route (moment 8): the branded loading state, never a spinner. Still light under reduced motion. */
function LoaderArt({ className }: { className: string }) {
  const svg = useRef<SVGSVGElement>(null);
  const isReduced = useReducedMotion();
  useEffect(() => {
    const el = svg.current;
    const path = el?.querySelector<SVGPathElement>('.tr');
    if (!el || !path) return;
    const pts: Pt[] = sample(path, 40);
    const still = el.querySelector<SVGElement>('.still');
    const mid = pts[20];
    if (still && mid) still.style.transform = translate(mid);
    if (reduced()) return;
    const d = ms('pulse') * 0.75;
    const anims = [
      loop(el.querySelector('.hd')!, pts, { duration: d }),
      ...[...el.querySelectorAll('.tl')].map((tl, i) =>
        loop(tl, pts, {
          duration: d,
          delay: ms('instant') * 0.75 * (i + 1),
          peak: [0.6, 0.35, 0.18][i] ?? 0.2,
        }),
      ),
    ];
    const unwatch = watch(el.parentElement ?? el);
    return () => {
      unwatch();
      anims.forEach((a) => a?.cancel());
    };
  }, [isReduced]);
  return (
    <svg ref={svg} viewBox="0 0 160 70" className={className} aria-hidden="true" focusable="false">
      <path className="tr" d={TINY_ROUTE} />
      <circle className="pt-a" cx="12" cy="58" r="5" />
      <circle className="pt-b" cx="148" cy="12" r="5" />
      <circle className="tl" r="3" />
      <circle className="tl" r="2.4" />
      <circle className="tl" r="1.8" />
      <circle className="hd" r="5" />
      <circle className="still" r="5" />
    </svg>
  );
}

/**
 * Branded loading state: a light travelling a tiny route plus a status line. `aria-busy` belongs on the page region
 * that is loading; the status text is the message. Pass `label` to say what is loading (defaults to "Loading").
 */
export function Loader({ label, children }: { label?: string; children?: React.ReactNode }) {
  return (
    <div role="status" className="loader">
      <LoaderArt className="ld" />
      <p className="type-h3">{label ?? t('a11y.loading')}</p>
      {children}
    </div>
  );
}

/** Inline 56 px version, for buttons rows and map frames. */
export function MiniLoader({ label }: { label: string }) {
  return (
    <span className="mini-loader">
      <LoaderArt className="ld mini-ld" />
      <span className="text-sm leading-5 text-text-muted">{label}</span>
    </span>
  );
}
