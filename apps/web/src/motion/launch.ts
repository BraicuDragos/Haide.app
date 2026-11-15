import { dist, ease, ms, reduced, run, scale } from './core';

/**
 * The Haide moment (moment 7, ADR 0020): the main action leaves. The button gives (`press`), the label slides out,
 * the brand dot travels the button with `departure` while a tint wipe follows, a ring flashes, the wordmark shows
 * for about `slow`, then the confirmed text springs in. About `launch` to the confirmed state.
 *
 * `.is-done` is the calm confirmed state in CSS, so the animations only decorate: reduced motion adds the class and
 * resolves after `moderate`, with no travel and no wordmark. Resolves when navigation may happen.
 * `haide` must be false when the request was only queued offline (the action did not really leave).
 */
export function playLaunch(
  btn: HTMLElement,
  { haide = true }: { haide?: boolean } = {},
): Promise<void> {
  return new Promise((resolve) => {
    btn.classList.add('is-done');
    btn.setAttribute('aria-disabled', 'true');
    if (reduced()) {
      window.setTimeout(resolve, ms('moderate'));
      return;
    }
    // optional haptic where supported, never with reduced motion, and the app works identically without it
    navigator.vibrate?.(ms('instant') * 0.15);
    const q = (s: string) => btn.querySelector<HTMLElement>(s);
    const width = btn.clientWidth;
    const departure = ease('departure');
    const standard = ease('standard');
    const instant = ms('instant');
    const travel = ms('slow'); // dot and wipe: a little under `launch` / 2

    run(btn, [{ transform: `scale(${scale('press')})` }, { transform: 'none' }], {
      duration: instant * 1.75,
      easing: standard,
    });
    const l1 = q('.l1');
    if (l1)
      run(
        l1,
        [
          { opacity: 1, transform: 'none' },
          { opacity: 0, transform: `translateX(-${dist('rise')})` },
        ],
        {
          duration: ms('fast') + instant * 0.5,
          delay: instant * 0.75,
          easing: ease('exit'),
          fill: 'both',
        },
      );
    const dot = q('.dotl');
    if (dot)
      run(
        dot,
        [
          { opacity: 1, transform: 'translateX(0)' },
          { opacity: 1, transform: `translateX(${width}px)` },
        ],
        {
          duration: travel,
          delay: instant * 1.25,
          easing: departure,
        },
      );
    const wipe = q('.wipe');
    if (wipe)
      run(wipe, [{ transform: 'scaleX(0)' }, { transform: 'scaleX(1)' }], {
        duration: travel,
        delay: instant * 1.75,
        easing: departure,
      });
    const mark = q('.l3');
    const wordAt = ms('launch') * 0.55;
    if (haide && mark)
      run(
        mark,
        [
          { opacity: 0, transform: `translateY(${dist('rise')})` },
          { opacity: 1, transform: 'none', offset: 0.3 },
          { opacity: 1, transform: 'none', offset: 0.72 },
          { opacity: 0, transform: `translateY(-${dist('nudge')})` },
        ],
        { duration: ms('slow'), delay: wordAt, easing: standard, fill: 'none' },
      );
    const confirmedAt = haide ? ms('launch') * 0.93 : wordAt;
    const l2 = q('.l2');
    if (l2)
      run(
        l2,
        [
          { opacity: 0, transform: `translateY(${dist('rise')})` },
          { opacity: 1, transform: 'none' },
        ],
        {
          duration: ms('slow'),
          delay: confirmedAt,
          easing: ease('spring'),
        },
      );
    const ring = btn.parentElement?.querySelector<HTMLElement>('.cta-ring');
    if (ring)
      run(
        ring,
        [
          { opacity: 0.9, transform: 'scale(1)' },
          { opacity: 0, transform: 'scale(1.1, 1.5)' },
        ],
        {
          duration: ms('slow') + instant * 1.25,
          delay: wordAt,
          easing: standard,
          fill: 'none',
        },
      );
    window.setTimeout(resolve, haide ? ms('launch') * 1.17 : ms('launch') * 0.95);
  });
}
