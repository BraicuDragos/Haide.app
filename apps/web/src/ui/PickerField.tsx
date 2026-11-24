import type { ReactNode, Ref } from 'react';
import { Icon, type IconName } from './Icon';

interface Props {
  id: string;
  label: string;
  /** Text shown as the value; '' shows the placeholder instead. */
  display: string;
  placeholder: string;
  icon: IconName;
  onOpen: () => void;
  hint?: ReactNode;
  error?: string | undefined;
  ref?: Ref<HTMLButtonElement>;
  /** The sheet this field opens (rendered next to the button, so it stays inside the same form cell). */
  children?: ReactNode;
}

/**
 * The one trigger for every "pick a day / time" field (Day, Leave around, Leaving at, Until): the same height, radius,
 * border and type on iOS, Android and desktop (a native select is taller than a button on iOS, which is why this
 * exists). A button with aria-haspopup=dialog whose name is the label plus the value; the error and the hint are wired
 * like Field.tsx (aria-invalid, aria-describedby, role=alert).
 */
export function PickerField({
  id,
  label,
  display,
  placeholder,
  icon,
  onOpen,
  hint,
  error,
  ref,
  children,
}: Props) {
  const hintId = `${id}-hint`;
  const errId = `${id}-err`;
  const describedBy =
    [hint ? hintId : '', error ? errId : ''].filter(Boolean).join(' ') || undefined;
  return (
    <div className="flex min-w-0 flex-col gap-1">
      <span id={`${id}-label`} className="type-label">
        {label}
      </span>
      <button
        id={id}
        ref={ref}
        type="button"
        aria-haspopup="dialog"
        aria-labelledby={`${id}-label ${id}-value`}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy}
        onClick={onOpen}
        className={`control picker-field ${error ? 'border-2 border-error' : 'border border-border-strong'}`}
      >
        <Icon name={icon} small className="flex-none text-text-muted" />
        <span
          id={`${id}-value`}
          className={`min-w-0 flex-1 truncate ${display ? 'font-semibold tabular-nums' : 'text-text-muted'}`}
        >
          {display || placeholder}
        </span>
        <Icon name="down" small className="picker-chev flex-none text-text-muted" />
      </button>
      {hint && (
        <p id={hintId} className="text-sm leading-5 text-text-muted">
          {hint}
        </p>
      )}
      {error && (
        <p
          id={errId}
          role="alert"
          className="flex items-start gap-1.5 text-sm leading-5 font-semibold text-error"
        >
          <Icon name="alert" small className="mt-0.5" />
          {error}
        </p>
      )}
      {children}
    </div>
  );
}
