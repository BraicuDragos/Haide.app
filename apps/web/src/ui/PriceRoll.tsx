import { useLayoutEffect, useRef } from 'react';
import { ease, ms, reduced, run, stagger } from '@/motion/core';
import { useReducedMotion } from '@/lib/prefs';

const DIGITS = '01234567890123456789'.split('');
const STEP = 5; // each digit is a strip of 20 cells (0-9 twice), 5% of the strip per cell

const shift = (i: number) => `translateY(${-i * STEP}%)`;

interface Props {
  /** Already formatted amount, e.g. "3.80". Money formatting stays in lib/format.ts: the roll only animates digits. */
  value: string;
  /** Roll from this value instead of from zero (a price drop rolls down from where the digits are). */
  from?: string;
  /** Spoken amount with currency, e.g. "3.80 RON". Defaults to `value`. */
  label?: string;
  /** Play the roll on mount. Lists show prices as plain text (no roll), so this is off by default. */
  animate?: boolean;
  className?: string;
}

/**
 * Price reveal (moment 5): odometer digits clipped in strips, moved with transform only, `spring` easing, `step`
 * stagger. The visual roll is `aria-hidden` and a screen-reader-only span carries the amount. Reduced motion: the
 * numbers simply swap. Never counts up as an integer (that would imply a total that is not true).
 */
export function PriceRoll({ value, from, label, animate = false, className = '' }: Props) {
  const strips = useRef<Array<HTMLSpanElement | null>>([]);
  const prev = useRef<string | null>(null);
  const isReduced = useReducedMotion();

  useLayoutEffect(() => {
    const digits = [...value].filter((c) => /\d/.test(c)).map(Number);
    const before = [...(prev.current ?? from ?? '')].filter((c) => /\d/.test(c)).map(Number);
    const first = prev.current === null;
    const anims: Array<Animation | null> = [];
    digits.forEach((d, i) => {
      const s = strips.current[i];
      if (!s) return;
      const end = d + 10;
      s.style.transform = shift(end);
      const start = before[i] !== undefined ? before[i]! + 10 : first && animate ? 0 : end;
      if (!reduced() && start !== end && (animate || !first))
        anims.push(
          run(s, [{ transform: shift(start) }, { transform: shift(end) }], {
            duration: ms('reveal'),
            delay: ms('instant') * 2 + stagger(i),
            easing: ease('spring'),
          }),
        );
    });
    prev.current = value;
    return () => anims.forEach((a) => a?.cancel());
  }, [value, from, animate, isReduced]);

  let di = -1;
  return (
    <span className={`price-roll ${className}`}>
      <span className="sr-only">{label ?? value}</span>
      <span className="roll" aria-hidden="true">
        {[...value].map((ch, i) => {
          if (!/\d/.test(ch))
            return (
              <span key={i} className="sep">
                {ch}
              </span>
            );
          const n = ++di;
          return (
            <span key={i} className="dg">
              <span
                ref={(el) => {
                  strips.current[n] = el;
                }}
                className="st"
              >
                {DIGITS.map((c, k) => (
                  <i key={k}>{c}</i>
                ))}
              </span>
            </span>
          );
        })}
      </span>
    </span>
  );
}
