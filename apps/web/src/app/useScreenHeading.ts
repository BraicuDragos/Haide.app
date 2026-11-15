import { useEffect, useLayoutEffect, useRef } from 'react';
import { useLocation } from 'react-router';

/**
 * Accessibility rules 2.4.2 / 2.4.3: every route sets document.title, and after an in-app navigation focus moves to
 * the screen's h1 (not on the very first page load, so nothing steals focus from the skip link).
 *
 * Usage: `const h1 = useScreenHeading(t('find.title'));` then `<h1 ref={h1} tabIndex={-1}>`.
 */
let navigations = 0;

/** Mounted once in the Shell: counts navigations so screens know whether this render follows one. */
export function useNavigationCounter(): void {
  const { key } = useLocation();
  const first = useRef(true);
  // Layout effects of the whole tree run before passive effects, so screens see the updated count.
  useLayoutEffect(() => {
    if (first.current) first.current = false;
    else navigations += 1;
  }, [key]);
}

export function useScreenHeading(title: string) {
  const ref = useRef<HTMLHeadingElement>(null);
  const { key } = useLocation();

  useEffect(() => {
    document.title = `${title} · Haide`;
  }, [title]);

  // Only on route changes, not when the title text changes (for example loading to loaded).
  useEffect(() => {
    if (navigations > 0) ref.current?.focus();
  }, [key]);

  return ref;
}
