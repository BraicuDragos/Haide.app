import { useEffect, useRef } from 'react';
import { useNavigate } from 'react-router';
import { reducedMotion } from '@/lib/prefs';
import {
  decideIntent,
  directionOf,
  dragOffset,
  inStartZone,
  shouldCommit,
  targetIndex,
  type Direction,
} from './swipeMath';

/**
 * A gesture that starts on or inside any of these is never a tab swipe: it belongs to that element (typing, sliding,
 * panning a map, cropping a photo, scrolling a wheel). `.touch-none` marks elements that handle their own touches.
 */
export const NO_SWIPE_SELECTOR = [
  'input',
  'textarea',
  'select',
  '[contenteditable]:not([contenteditable="false"])',
  '[role="slider"]',
  '[role="listbox"]',
  'canvas',
  '.maplibregl-map',
  'dialog',
  '[data-no-swipe]',
  '.touch-none',
].join(',');

/** Slide duration guard: the direction attribute stays on <html> for the View Transition, then is removed. */
const DIRECTION_CLEAR_MS = 600;

/** True when this element, or an ancestor up to `root`, must keep the gesture to itself. */
export function blocksSwipe(start: Element, root: Element): boolean {
  for (let el: Element | null = start; el && el !== root.parentElement; el = el.parentElement) {
    if (el.matches(NO_SWIPE_SELECTOR)) return true;
    if (el.scrollWidth > el.clientWidth) {
      const ox = getComputedStyle(el).overflowX;
      if (ox === 'auto' || ox === 'scroll') return true;
    }
  }
  return false;
}

interface Options {
  /** Tab routes in bar order. */
  paths: readonly string[];
  /** Index of the current tab, or -1 when the current screen is not a root tab. */
  index: number;
  /** Swiping works only on the root tab screens. */
  enabled: boolean;
}

/**
 * Horizontal swipe between the root tabs (left = next, right = previous, no wrap). Pointer events with `touch-action:
 * pan-y pinch-zoom` on the surface, so vertical scrolling and pinch zoom stay native. Navigation is a normal push like
 * a tab tap, with the View Transition and a direction attribute on <html> that motion.css turns into a slide.
 */
export function useTabSwipe(root: HTMLElement | null, opts: Options): void {
  const navigate = useNavigate();
  const latest = useRef({ opts, navigate });
  latest.current = { opts, navigate };

  useEffect(() => {
    if (!root) return;

    interface Track {
      id: number;
      x0: number;
      y0: number;
      t0: number;
      intent: 'pending' | 'horizontal';
    }
    let track: Track | null = null;
    let dragging: HTMLElement | null = null;

    const reset = (animate: boolean) => {
      if (!dragging) return;
      const el = dragging;
      dragging = null;
      if (animate && !reducedMotion()) {
        el.style.transition =
          'transform var(--tk-dur-base, 200ms) var(--tk-ease-standard, ease-out)';
        el.style.transform = 'translate3d(0,0,0)';
        window.setTimeout(() => {
          el.style.transition = '';
          el.style.transform = '';
        }, 260);
      } else {
        el.style.transition = '';
        el.style.transform = '';
      }
    };
    const cancel = () => {
      track = null;
      reset(true);
    };

    const onDown = (e: PointerEvent) => {
      const { enabled } = latest.current.opts;
      if (e.pointerType !== 'touch') return;
      if (track) {
        // A second finger (pinch): drop the swipe entirely.
        cancel();
        return;
      }
      if (!enabled || !e.isPrimary) return;
      if (!inStartZone(e.clientX, window.innerWidth)) return;
      if (document.querySelector('dialog[open]')) return;
      if (window.getSelection()?.toString()) return;
      const target = e.target instanceof Element ? e.target : null;
      if (!target || blocksSwipe(target, root)) return;
      track = { id: e.pointerId, x0: e.clientX, y0: e.clientY, t0: e.timeStamp, intent: 'pending' };
    };

    const onMove = (e: PointerEvent) => {
      if (!track || e.pointerId !== track.id) return;
      const dx = e.clientX - track.x0;
      const dy = e.clientY - track.y0;
      if (track.intent === 'pending') {
        const intent = decideIntent(dx, dy);
        if (intent === 'pending') return;
        if (intent === 'cancel') {
          track = null;
          return;
        }
        track.intent = 'horizontal';
      }
      if (reducedMotion()) return;
      const { index, paths } = latest.current.opts;
      const has = targetIndex(index, paths.length, directionOf(dx)) !== null;
      const main = root.querySelector<HTMLElement>('main');
      if (!main) return;
      dragging = main;
      main.style.transition = 'none';
      main.style.transform = `translate3d(${dragOffset(dx, has)}px,0,0)`;
    };

    const onUp = (e: PointerEvent) => {
      if (!track || e.pointerId !== track.id) return;
      const t = track;
      track = null;
      const dx = e.clientX - t.x0;
      const dy = e.clientY - t.y0;
      const { index, paths } = latest.current.opts;
      const dir: Direction = directionOf(dx);
      const to = targetIndex(index, paths.length, dir);
      const hasSelection = Boolean(window.getSelection()?.toString());
      if (
        t.intent === 'horizontal' &&
        to !== null &&
        !hasSelection &&
        shouldCommit(dx, dy, e.timeStamp - t.t0, window.innerWidth)
      ) {
        reset(false);
        const html = document.documentElement;
        const slide = !reducedMotion();
        if (slide) {
          html.dataset.swipe = dir;
          window.setTimeout(() => delete html.dataset.swipe, DIRECTION_CLEAR_MS);
        }
        void latest.current.navigate(paths[to]!, { viewTransition: slide });
      } else {
        reset(true);
      }
    };

    const opt = { passive: true } as const;
    root.addEventListener('pointerdown', onDown, opt);
    root.addEventListener('pointermove', onMove, opt);
    root.addEventListener('pointerup', onUp, opt);
    root.addEventListener('pointercancel', cancel, opt);
    return () => {
      root.removeEventListener('pointerdown', onDown);
      root.removeEventListener('pointermove', onMove);
      root.removeEventListener('pointerup', onUp);
      root.removeEventListener('pointercancel', cancel);
      reset(false);
    };
  }, [root]);
}
