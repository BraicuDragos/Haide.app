import type {
  InputHTMLAttributes,
  ReactNode,
  Ref,
  SelectHTMLAttributes,
  TextareaHTMLAttributes,
} from 'react';
import { t } from '@/i18n';
import { Icon } from './Icon';

interface Common {
  id: string;
  label: string;
  /** Format hint as text, never a placeholder (accessibility.md 3.3.2). */
  hint?: ReactNode;
  /** Inline error text: sets aria-invalid and aria-describedby, announced with role=alert. */
  error?: string | undefined;
  optional?: boolean;
}

const BORDER = (error?: string) =>
  error ? 'border-2 border-error' : 'border border-border-strong';
const CONTROL = 'control';

function Shell({
  id,
  label,
  hint,
  error,
  optional,
  children,
}: Common & { children: (describedBy: string | undefined) => ReactNode }) {
  const hintId = `${id}-hint`;
  const errId = `${id}-err`;
  const describedBy =
    [hint ? hintId : '', error ? errId : ''].filter(Boolean).join(' ') || undefined;
  return (
    <div className="flex min-w-0 flex-col gap-1">
      <label htmlFor={id} className="type-label">
        {label}
        {optional && <span className="font-normal text-text-muted"> ({t('common.optional')})</span>}
      </label>
      {children(describedBy)}
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
    </div>
  );
}

type InputProps = Common &
  Omit<InputHTMLAttributes<HTMLInputElement>, 'id' | 'className'> & {
    ref?: Ref<HTMLInputElement>;
  };

export function TextField({ id, label, hint, error, optional, ref, ...rest }: InputProps) {
  return (
    <Shell {...{ id, label, hint, error, optional }}>
      {(describedBy) => (
        <input
          id={id}
          ref={ref}
          aria-invalid={error ? true : undefined}
          aria-describedby={describedBy}
          className={`min-h-12 ${CONTROL} ${BORDER(error)}`}
          {...rest}
        />
      )}
    </Shell>
  );
}

type AreaProps = Common &
  Omit<TextareaHTMLAttributes<HTMLTextAreaElement>, 'id' | 'className'> & {
    ref?: Ref<HTMLTextAreaElement>;
  };

export function TextArea({ id, label, hint, error, optional, ref, ...rest }: AreaProps) {
  return (
    <Shell {...{ id, label, hint, error, optional }}>
      {(describedBy) => (
        <textarea
          id={id}
          ref={ref}
          aria-invalid={error ? true : undefined}
          aria-describedby={describedBy}
          className={`min-h-24 py-3 ${CONTROL} ${BORDER(error)}`}
          {...rest}
        />
      )}
    </Shell>
  );
}

type SelectProps = Common &
  Omit<SelectHTMLAttributes<HTMLSelectElement>, 'id' | 'className'> & {
    ref?: Ref<HTMLSelectElement>;
  };

export function SelectField({
  id,
  label,
  hint,
  error,
  optional,
  ref,
  children,
  ...rest
}: SelectProps) {
  return (
    <Shell {...{ id, label, hint, error, optional }}>
      {(describedBy) => (
        <select
          id={id}
          ref={ref}
          aria-invalid={error ? true : undefined}
          aria-describedby={describedBy}
          className={`min-h-12 ${CONTROL} ${BORDER(error)}`}
          {...rest}
        >
          {children}
        </select>
      )}
    </Shell>
  );
}
