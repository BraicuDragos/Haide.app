import {
  useEffect,
  useRef,
  useState,
  type Dispatch,
  type KeyboardEvent,
  type ReactNode,
  type SetStateAction,
} from 'react';
import { t } from '@/i18n';
import {
  firstEnabled,
  indexFromScroll,
  lastEnabled,
  nearestEnabled,
  scrollForIndex,
  stepEnabled,
  typeAheadMatch,
  type WheelItem,
} from '@/lib/wheel';
import { Button } from './Button';
import { Sheet } from './Sheet';

/** Reduced motion, from the app's own setting first and the OS second (prefs.ts keeps both in sync on <html>). */
export function motionReduced(): boolean {
  if (typeof document === 'undefined') return false;
  const set = document.documentElement.dataset.motion;
  if (set) return set === 'reduced';
  try {
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  } catch {
    return false;
  }
}

/** A tiny haptic tick, only where the browser supports it (not iOS Safari) and never with reduced motion. */
function tick() {
  if (motionReduced()) return;
  try {
    navigator.vibrate?.(5);
  } catch {
    /* no haptics here */
  }
}

const SETTLE_MS = 110;
const TYPE_MS = 900;

interface ColumnProps {
  id: string;
  /** Accessible name of the listbox ('Hours', 'Minutes', 'Day'). */
  label: string;
  items: WheelItem[];
  /** Value of the selected row; '' (or an unknown value) falls back to the nearest enabled row. */
  value: string;
  onChange: (value: string) => void;
  /** Called by Enter on the wheel: confirms the sheet. */
  onEnter?: () => void;
  autoFocus?: boolean;
  /** `lg`: big numerals (time); `md`: words (day names). */
  size?: 'lg' | 'md';
}

/**
 * One alarm-style wheel: a vertically scrolling, scroll-snapping list whose centre row is the selection. The browser
 * does the momentum and the snapping; the selection follows the scroll position and the wheel settles on the nearest
 * enabled row (disabled rows are dimmed and can never be chosen). For keyboards and screen readers it is a plain
 * single-select listbox: Up/Down, PageUp/PageDown (5), Home/End and type-ahead, with aria-activedescendant.
 */
export function WheelColumn({
  id,
  label,
  items,
  value,
  onChange,
  onEnter,
  autoFocus,
  size = 'lg',
}: ColumnProps) {
  const ref = useRef<HTMLDivElement>(null);
  const known = items.findIndex((i) => i.value === value);
  const sel = known >= 0 && !items[known]!.disabled ? known : nearestEnabled(items, known);
  const pos = Math.max(0, sel);

  // Latest props for the scroll handlers, which outlive a render.
  const latest = useRef({ items, sel, onChange });
  latest.current = { items, sel, onChange };

  const programmatic = useRef(false); // our own scrollTo is running: ignore its scroll events
  const guard = useRef<number | undefined>(undefined);
  const settle = useRef<number | undefined>(undefined);
  const fromScroll = useRef(false); // the last change came from the user's scroll: do not scroll again
  const typed = useRef({ text: '', at: 0 });

  function scrollTo(index: number, smooth: boolean) {
    const el = ref.current;
    if (!el) return;
    const top = scrollForIndex(index);
    // Already there. Not while an earlier smooth scroll is still running: it would carry on to its old target.
    if (!programmatic.current && Math.abs(el.scrollTop - top) < 1) return;
    programmatic.current = true;
    window.clearTimeout(guard.current);
    // Safety net: a scroll event that never comes must not leave the wheel deaf.
    guard.current = window.setTimeout(() => (programmatic.current = false), 1000);
    if (smooth && !motionReduced() && typeof el.scrollTo === 'function') {
      el.scrollTo({ top, behavior: 'smooth' });
    } else {
      el.scrollTop = top;
    }
  }

  // Open on the selected row. The dialog is shown by Sheet's own effect, which runs after this one, and a closed
  // dialog has no layout to scroll: wait for the microtask.
  useEffect(() => {
    queueMicrotask(() => {
      scrollTo(latest.current.sel < 0 ? 0 : latest.current.sel, false);
      if (autoFocus) ref.current?.focus({ preventScroll: true });
    });
    return () => {
      window.clearTimeout(guard.current);
      window.clearTimeout(settle.current);
    };
  }, []);

  // A change that did not come from this wheel's own scrolling (tap, key, the other wheel) moves the wheel to it.
  const first = useRef(true);
  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    if (fromScroll.current) {
      fromScroll.current = false;
      return;
    }
    scrollTo(pos, true);
  }, [pos]);

  function onScroll() {
    const el = ref.current;
    if (!el) return;
    window.clearTimeout(settle.current);
    settle.current = window.setTimeout(onSettled, SETTLE_MS);
    if (programmatic.current) return;
    const { items: list, sel: cur, onChange: emit } = latest.current;
    const next = nearestEnabled(list, indexFromScroll(el.scrollTop, list.length));
    if (next >= 0 && next !== cur) {
      fromScroll.current = true;
      tick();
      emit(list[next]!.value);
    }
  }

  function onSettled() {
    const el = ref.current;
    if (!el) return;
    if (programmatic.current) {
      programmatic.current = false;
      // A smooth scroll that was interrupted can rest elsewhere than the selection: put the wheel back on it.
      scrollTo(Math.max(0, latest.current.sel), false);
      return;
    }
    const { items: list } = latest.current;
    const raw = indexFromScroll(el.scrollTop, list.length);
    const near = nearestEnabled(list, raw);
    if (near >= 0 && near !== raw) scrollTo(near, true); // came to rest on a disabled row
  }

  function choose(index: number) {
    const item = latest.current.items[index];
    if (!item || item.disabled) return;
    if (index !== latest.current.sel) tick();
    latest.current.onChange(item.value);
    // Same value (re-tap, or a wheel that was left between rows): still centre it.
    if (index === latest.current.sel) scrollTo(index, true);
  }

  function onKeyDown(e: KeyboardEvent<HTMLDivElement>) {
    const { items: list, sel: cur } = latest.current;
    let next = -1;
    if (e.key === 'ArrowDown') next = stepEnabled(list, cur, 1);
    else if (e.key === 'ArrowUp') next = stepEnabled(list, cur, -1);
    else if (e.key === 'PageDown') next = stepEnabled(list, cur, 5);
    else if (e.key === 'PageUp') next = stepEnabled(list, cur, -5);
    else if (e.key === 'Home') next = firstEnabled(list);
    else if (e.key === 'End') next = lastEnabled(list);
    else if (e.key === 'Enter') {
      if (onEnter) {
        e.preventDefault();
        onEnter();
      }
      return;
    } else if (e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey && e.key !== ' ') {
      const now = Date.now();
      const buf = now - typed.current.at > TYPE_MS ? e.key : typed.current.text + e.key;
      typed.current = { text: buf, at: now };
      next = typeAheadMatch(list, buf);
      // A second digit that matches nothing ("5" then "9" in minutes): start over with the new key.
      if (next < 0 && buf.length > 1) {
        typed.current = { text: e.key, at: now };
        next = typeAheadMatch(list, e.key);
      }
      e.preventDefault();
    } else return;
    e.preventDefault();
    if (next >= 0) choose(next);
  }

  return (
    <div className={`wheel-col ${size === 'lg' ? 'wheel-lg' : 'wheel-md'}`}>
      <div
        ref={ref}
        id={id}
        role="listbox"
        aria-label={label}
        aria-activedescendant={sel >= 0 ? `${id}-${sel}` : undefined}
        tabIndex={0}
        onScroll={onScroll}
        onKeyDown={onKeyDown}
        className="wheel"
      >
        {items.map((item, i) => (
          <div
            key={item.value}
            id={`${id}-${i}`}
            role="option"
            aria-selected={i === sel}
            aria-disabled={item.disabled || undefined}
            data-value={item.value}
            onClick={() => choose(i)}
            className="wheel-item"
          >
            <span>{item.label}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

/** The wheels side by side behind one highlighted centre band. */
export function WheelRow({ children }: { children: ReactNode }) {
  return <div className="wheels">{children}</div>;
}

/** The ':' between hours and minutes. */
export function WheelColon() {
  return (
    <span aria-hidden="true" className="wheel-colon">
      :
    </span>
  );
}

interface SheetProps<T> {
  open: boolean;
  title: string;
  onClose: () => void;
  /** The draft the wheels start from. Called each time the sheet opens, so "now" is never stale. */
  init: () => T;
  /** Text announced (live region) whenever the draft changes. */
  summary: (draft: T) => string;
  /** False disables "Set" (nothing valid to set yet). */
  isValid?: (draft: T) => boolean;
  confirmLabel: string;
  onConfirm: (draft: T) => void;
  /** The wheels. `confirm` is for Enter on a wheel. */
  children: (draft: T, setDraft: Dispatch<SetStateAction<T>>, confirm: () => void) => ReactNode;
}

/** A bottom sheet with wheels, a live readout for screen readers, and Cancel / Set. Cancel, Esc, the backdrop and the
 * close button all leave the value unchanged. */
export function WheelSheet<T>({ open, title, onClose, ...rest }: SheetProps<T>) {
  return (
    <Sheet open={open} title={title} onClose={onClose}>
      <Body onClose={onClose} {...rest} />
    </Sheet>
  );
}

function Body<T>({
  onClose,
  init,
  summary,
  isValid,
  confirmLabel,
  onConfirm,
  children,
}: Omit<SheetProps<T>, 'open' | 'title'>) {
  const [draft, setDraft] = useState(init);
  const ok = isValid ? isValid(draft) : true;
  const confirm = () => {
    if (ok) onConfirm(draft);
  };
  return (
    <>
      <WheelRow>{children(draft, setDraft, confirm)}</WheelRow>
      <p role="status" aria-live="polite" className="sr-only">
        {summary(draft)}
      </p>
      <div className="mt-auto grid grid-cols-2 gap-3">
        <Button variant="secondary" onClick={onClose}>
          {t('time.cancel')}
        </Button>
        <Button disabled={!ok} onClick={confirm}>
          {confirmLabel}
        </Button>
      </div>
    </>
  );
}
