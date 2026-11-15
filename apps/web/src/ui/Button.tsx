import type { ButtonHTMLAttributes, ReactNode, Ref } from 'react';

type Variant = 'primary' | 'secondary' | 'tonal' | 'ghost' | 'danger';

interface Props extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  block?: boolean;
  loading?: boolean;
  icon?: ReactNode;
  ref?: Ref<HTMLButtonElement>;
}

/**
 * Pill buttons (styles in globals.css). One primary (saffron in dark, indigo in light) per screen; secondary is the
 * outline pair `outline` / `on-outline`, which passes contrast in both themes. `loading` shows the branded
 * mini light instead of a spinner.
 */
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
      className={`btn btn-${variant} ${block ? 'btn-block' : ''} ${className}`}
      {...rest}
    >
      {loading ? <span className="btn-light" aria-hidden="true" /> : icon}
      {children}
    </button>
  );
}
