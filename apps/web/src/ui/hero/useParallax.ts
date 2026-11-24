import { useEffect, type RefObject } from 'react';
import { clamp, parallaxOffset } from '@/motion/geometry';
import { useReducedMotion } from '@/lib/prefs';

/**
 * Gentle depth for the hero: layers marked `data-depth` drift against the finger / pointer and, where no permission
 * prompt is needed (Android, desktop), against the device tilt. Position is eased in a rAF loop that only runs while
 * the layers are still settling (nothing runs at rest), and only while the hero is on screen. Transform only. Off under
 * reduced motion (OS or in-app): the layers stay put.
 */
export function useParallax(ref: RefObject<HTMLElement | null>, enabled: boolean) {
  const reduced = useReducedMotion();
  useEffect(() => {
    const el = ref.current;
    if (!el || !enabled || reduced || typeof window === 'undefined') return;
    const layers = [...el.querySelectorAll<HTMLElement>('[data-depth]')];
    let tx = 0;
    let ty = 0;
    let cx = 0;
    let cy = 0;
    let raf = 0;
    const tick = () => {
      cx += (tx - cx) * 0.08;
      cy += (ty - cy) * 0.08;
      layers.forEach((l) => {
        const o = parallaxOffset(cx, cy, Number(l.dataset.depth));
        l.style.transform = `translate3d(${o.x.toFixed(2)}px, ${o.y.toFixed(2)}px, 0)`;
      });
      raf = Math.abs(tx - cx) + Math.abs(ty - cy) > 0.002 ? requestAnimationFrame(tick) : 0;
    };
    const aim = (x: number, y: number) => {
      if (el.getBoundingClientRect().bottom <= 0) return; // scrolled away: nothing to move
      tx = clamp(x, -1, 1);
      ty = clamp(y, -1, 1);
      if (!raf) raf = requestAnimationFrame(tick);
    };
    const onMove = (e: PointerEvent) =>
      aim((e.clientX / innerWidth - 0.5) * 2, (e.clientY / innerHeight - 0.5) * 2);
    const rest = () => aim(0, 0);
    const onTilt = (e: DeviceOrientationEvent) => {
      if (e.gamma !== null && e.beta !== null) aim(e.gamma / 25, (e.beta - 45) / 25);
    };
    addEventListener('pointermove', onMove, { passive: true });
    addEventListener('pointerup', rest, { passive: true });
    addEventListener('pointercancel', rest, { passive: true });
    // iOS asks permission for tilt: never prompt, simply stay on the pointer.
    const needsAsk =
      typeof (window.DeviceOrientationEvent as { requestPermission?: unknown } | undefined)
        ?.requestPermission === 'function';
    if (!needsAsk && 'DeviceOrientationEvent' in window)
      addEventListener('deviceorientation', onTilt, { passive: true });
    return () => {
      cancelAnimationFrame(raf);
      removeEventListener('pointermove', onMove);
      removeEventListener('pointerup', rest);
      removeEventListener('pointercancel', rest);
      removeEventListener('deviceorientation', onTilt);
      layers.forEach((l) => (l.style.transform = ''));
    };
  }, [ref, enabled, reduced]);
}
