import { lazy, Suspense, useRef, type ComponentType } from 'react';

type SheetProps = { open: boolean };

/**
 * A sheet loaded on first open (initial JS stays within budget). After the first open it stays mounted, so closing
 * runs the dialog's own close and focus returns to the control that opened it.
 */
export function lazySheet<P extends SheetProps>(
  load: () => Promise<{ default: ComponentType<P> }>,
): ComponentType<P> {
  const Impl = lazy(load);
  return function LazySheet(props: P) {
    const seen = useRef(false);
    if (props.open) seen.current = true;
    if (!seen.current) return null;
    return (
      <Suspense fallback={null}>
        <Impl {...props} />
      </Suspense>
    );
  };
}
