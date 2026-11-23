import { useEffect, useRef, type KeyboardEvent } from 'react';

export interface SegTab<T extends string> {
  value: T;
  label: string;
}

/** DOM id of a tab, for the panel's aria-labelledby. */
export const tabId = (prefix: string, value: string) => `${prefix}-tab-${value}`;

/**
 * Pill tabs (WAI-ARIA tabs pattern): one tab stop, Left/Right/Home/End move and select. The panel is the caller's
 * element: give it role="tabpanel" and aria-labelledby={tabId(prefix, value)}.
 */
export function SegTabs<T extends string>({
  prefix,
  label,
  tabs,
  value,
  onChange,
}: {
  prefix: string;
  label: string;
  tabs: Array<SegTab<T>>;
  value: T;
  onChange: (v: T) => void;
}) {
  const refs = useRef<Array<HTMLButtonElement | null>>([]);
  // Set by a key press. URL-backed tabs navigate, and a screen moves focus to its heading after a navigation, so the
  // tab takes focus back in an effect of the same commit (this component's effects run after the heading's).
  const keep = useRef<number | null>(null);
  useEffect(() => {
    if (keep.current !== null) refs.current[keep.current]?.focus();
    keep.current = null;
  }, [value]);
  function key(e: KeyboardEvent, i: number) {
    const last = tabs.length - 1;
    const next =
      e.key === 'ArrowRight'
        ? (i + 1) % tabs.length
        : e.key === 'ArrowLeft'
          ? (i - 1 + tabs.length) % tabs.length
          : e.key === 'Home'
            ? 0
            : e.key === 'End'
              ? last
              : -1;
    if (next < 0) return;
    e.preventDefault();
    onChange(tabs[next]!.value);
    keep.current = next;
    refs.current[next]?.focus();
  }
  return (
    <div
      role="tablist"
      aria-label={label}
      className="grid auto-cols-fr grid-flow-col gap-1 rounded-full border border-(color:--hair) bg-bg-deep p-1"
    >
      {tabs.map((tab, i) => {
        const on = tab.value === value;
        return (
          <button
            key={tab.value}
            ref={(el) => {
              refs.current[i] = el;
            }}
            type="button"
            role="tab"
            id={tabId(prefix, tab.value)}
            aria-selected={on}
            tabIndex={on ? 0 : -1}
            onClick={() => onChange(tab.value)}
            onKeyDown={(e) => key(e, i)}
            className="min-h-11 rounded-full border border-transparent px-3 font-semibold text-text-muted aria-selected:border-outline aria-selected:bg-tint aria-selected:text-on-tint"
          >
            {tab.label}
          </button>
        );
      })}
    </div>
  );
}
