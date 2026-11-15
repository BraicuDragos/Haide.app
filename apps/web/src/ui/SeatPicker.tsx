import { useId, useLayoutEffect, useRef, type PointerEvent } from 'react';
import { dist, ease, ms, reduced, run, scale, settle, stagger } from '@/motion/core';
import { useReducedMotion } from '@/lib/prefs';
import { Icon } from './Icon';

interface PickerProps {
  /** Number of seats offered (1 to max). */
  max: number;
  /** Chosen number of seats (0 = none yet). */
  value: number;
  onChange: (n: number) => void;
  /** Visible legend of the group, e.g. "Seats for passengers". */
  legend: string;
  /** Spoken name of seat button n, e.g. "2 seats". */
  seatLabel: (n: number) => string;
  hint?: string;
  className?: string;
}

const LEAN_RADIUS = 120; // px: a mouse pointer within this distance pulls a seat toward it
const LEAN_MAX = 7; // px

/**
 * Seat selection (moment 3): tactile tokens with a magnetic spring. A real radio group (fieldset + legend, native
 * radios under the tokens) so keyboard and screen readers work like any radio set. Pressing scales to `press`; the
 * chosen count fills left to right with the `magnet` curve and a `step` stagger; with a mouse the tokens lean toward
 * the pointer (touch has no hover, it only gets the spring). Reduced motion: seats switch state instantly.
 * Reusable by Offer (driver picks free seats, E2) and by a passenger count if multi-seat requests arrive.
 */
export function SeatPicker({
  max,
  value,
  onChange,
  legend,
  seatLabel,
  hint,
  className = '',
}: PickerProps) {
  const name = useId();
  const faces = useRef<Array<HTMLSpanElement | null>>([]);
  const prev = useRef<number | null>(null);
  const isReduced = useReducedMotion();

  useLayoutEffect(() => {
    const was = prev.current;
    prev.current = value;
    if (reduced()) return;
    faces.current.forEach((f, i) => {
      if (!f) return;
      if (was === null) {
        // arrival: seats spring in once, staggered
        run(
          f,
          [
            { opacity: 0, transform: `translateY(${dist('rise')}) scale(${scale('press')})` },
            { opacity: 1, transform: 'none' },
          ],
          {
            duration: settle(),
            delay: ms('moderate') + stagger(i),
            easing: ease('magnet'),
          },
        );
        return;
      }
      const on = i < value;
      const wasOn = i < was;
      if (on && !wasOn)
        run(
          f,
          [
            { transform: `translateY(${dist('rise')}) scale(${scale('press')})` },
            { transform: 'none' },
          ],
          {
            duration: settle(),
            delay: stagger(i - was),
            easing: ease('magnet'),
          },
        );
      else if (!on && wasOn)
        run(f, [{ transform: `scale(${scale('press')})` }, { transform: 'none' }], {
          duration: ms('base'),
          easing: ease('standard'),
        });
    });
  }, [value, isReduced]);

  const lean = (e: PointerEvent<HTMLDivElement>) => {
    if (e.pointerType !== 'mouse' || reduced()) return;
    // Read every rect first, then write: no layout is forced between the writes.
    const mags = [...e.currentTarget.querySelectorAll<HTMLElement>('.mag')];
    const rects = mags.map((m) => m.getBoundingClientRect());
    mags.forEach((m, i) => {
      const r = rects[i]!;
      const dx = e.clientX - (r.left + r.width / 2);
      const dy = e.clientY - (r.top + r.height / 2);
      const d = Math.hypot(dx, dy);
      const pull = d < LEAN_RADIUS ? (1 - d / LEAN_RADIUS) * LEAN_MAX : 0;
      m.style.setProperty('--mx', d ? `${(dx / d) * pull}px` : '0px');
      m.style.setProperty('--my', d ? `${(dy / d) * pull}px` : '0px');
    });
  };
  const unlean = (e: PointerEvent<HTMLDivElement>) =>
    e.currentTarget.querySelectorAll<HTMLElement>('.mag').forEach((m) => {
      m.style.removeProperty('--mx');
      m.style.removeProperty('--my');
    });

  return (
    <fieldset className={`m-0 flex min-w-0 flex-col gap-2 border-0 p-0 ${className}`}>
      <legend className="type-label mb-1 p-0">{legend}</legend>
      <div className="seats" onPointerMove={lean} onPointerLeave={unlean}>
        {Array.from({ length: max }, (_, i) => i + 1).map((n) => (
          <label key={n} className="seat">
            <input
              type="radio"
              name={name}
              value={n}
              checked={value === n}
              onChange={() => onChange(n)}
              onPointerDown={(e) => {
                const f = faces.current[n - 1];
                if (f && !reduced() && e.pointerType !== 'mouse')
                  run(f, [{ transform: `scale(${scale('press')})` }, { transform: 'none' }], {
                    duration: ms('instant') + ms('instant') * 0.5,
                    easing: ease('standard'),
                  });
              }}
            />
            <span className="mag">
              <span
                ref={(el) => {
                  faces.current[n - 1] = el;
                }}
                className={`face ${n <= value ? 'on' : ''}`}
              >
                <Icon name="seat" />
              </span>
            </span>
            <span className="sr-only">{seatLabel(n)}</span>
          </label>
        ))}
      </div>
      {hint && <p className="text-sm leading-5 text-text-muted">{hint}</p>}
    </fieldset>
  );
}

/**
 * Read-only seat strip for ride details: taken seats filled (tinted), free seats dashed. Decorative: the words
 * ("2 seats left of 3") carry the meaning, so it is `aria-hidden`.
 */
export function SeatStrip({ total, taken }: { total: number; taken: number }) {
  const ref = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    if (reduced() || !ref.current) return;
    ref.current.querySelectorAll('.face').forEach((f, i) =>
      run(
        f,
        [
          { opacity: 0, transform: `translateY(${dist('rise')}) scale(${scale('press')})` },
          { opacity: 1, transform: 'none' },
        ],
        {
          duration: settle(),
          delay: ms('moderate') + stagger(i),
          easing: ease('magnet'),
        },
      ),
    );
  }, []);
  return (
    <div ref={ref} className="seatrow" aria-hidden="true">
      {Array.from({ length: total }, (_, i) => (
        <span key={i} className={`face ${i < taken ? 'taken' : 'free'}`}>
          <Icon name="seat" />
        </span>
      ))}
    </div>
  );
}
