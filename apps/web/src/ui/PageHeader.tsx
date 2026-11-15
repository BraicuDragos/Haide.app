import { useScreenHeading } from '@/app/useScreenHeading';

/** Sticky screen title bar. Owns the single h1 of the screen, the document title and focus-on-navigate. */
export function PageHeader({ title }: { title: string }) {
  const ref = useScreenHeading(title);
  return (
    <header className="sticky top-0 z-10 flex min-h-14 items-center border-b border-border bg-bg px-4">
      <h1 ref={ref} tabIndex={-1} className="type-h3">
        {title}
      </h1>
    </header>
  );
}
