import type { ReactNode } from 'react';
import { TINY_ROUTE } from './Loader';

/**
 * Empty state pattern (copy.md section 4): what this is, why it is empty, one way to start. The route waits as a
 * dashed line and its start dot breathes once every few seconds (moment 8); still under reduced motion.
 */
export function EmptyState({
  title,
  body,
  children,
}: {
  title: string;
  body: string;
  children?: ReactNode;
}) {
  return (
    <div className="empty">
      <svg viewBox="0 0 160 70" className="empty-art" aria-hidden="true" focusable="false">
        <path className="tr" d={TINY_ROUTE} />
        <circle className="pt-b" cx="148" cy="12" r="5" />
        <circle className="pt-a breath" cx="12" cy="58" r="5" />
      </svg>
      <h2 className="type-h2">{title}</h2>
      <p className="max-w-[32ch] text-text-muted">{body}</p>
      {children}
    </div>
  );
}
