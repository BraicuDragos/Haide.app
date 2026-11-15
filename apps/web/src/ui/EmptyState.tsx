import type { ReactNode } from 'react';

/** Empty state pattern (copy.md section 4): what this is, why it is empty, one way to start. */
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
    <div className="flex flex-col items-center gap-3 px-6 py-12 text-center">
      <svg viewBox="0 0 120 80" aria-hidden="true" focusable="false" className="h-20 w-30">
        <path
          d="M10 68C34 68 40 40 62 36S98 28 110 10"
          fill="none"
          stroke="var(--color-primary-300)"
          strokeWidth="4"
          strokeLinecap="round"
          strokeDasharray="1 9"
        />
        <circle
          cx="110"
          cy="10"
          r="6"
          fill="var(--color-accent)"
          stroke="var(--color-primary-700)"
          strokeWidth="3"
        />
        <circle
          cx="10"
          cy="68"
          r="5"
          fill="var(--color-surface)"
          stroke="var(--color-primary-700)"
          strokeWidth="3"
        />
      </svg>
      <h2 className="type-h2">{title}</h2>
      <p className="max-w-[32ch] text-text-muted">{body}</p>
      {children}
    </div>
  );
}
