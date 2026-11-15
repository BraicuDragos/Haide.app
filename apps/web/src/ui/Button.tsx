import type { ButtonHTMLAttributes, ReactNode } from 'react';

type Variant = 'primary' | 'secondary' | 'tonal' | 'ghost' | 'danger';

const VARIANT: Record<Variant, string> = {
  primary: 'bg-action text-on-action hover:bg-action-hover active:bg-action-pressed',
  secondary: 'bg-surface text-primary-700 border-action hover:bg-tint',
  tonal: 'bg-tint text-on-tint hover:bg-primary-100',
  ghost: 'bg-transparent text-link min-h-11 px-3 py-2',
  danger: 'bg-error text-white',
};

interface Props extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  block?: boolean;
  loading?: boolean;
  icon?: ReactNode;
}

export function Button({
  variant = 'primary',
  block,
  loading,
  icon,
  className = '',
  children,
  disabled,
  ...rest
}: Props) {
  return (
    <button
      type="button"
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      className={[
        'inline-flex min-h-12 items-center justify-center gap-2 rounded-md border-2 border-transparent px-5 py-3',
        'text-center text-md leading-5 font-semibold transition-colors duration-(--tk-dur-fast) ease-standard',
        'disabled:cursor-not-allowed disabled:bg-surface-subtle disabled:text-text-muted',
        block ? 'w-full' : '',
        VARIANT[variant],
        className,
      ].join(' ')}
      {...rest}
    >
      {loading ? (
        <span
          className="spin size-4 rounded-full border-2 border-current border-r-transparent"
          style={{ animation: 'spin 0.8s linear infinite' }}
          aria-hidden="true"
        />
      ) : (
        icon
      )}
      {children}
    </button>
  );
}
