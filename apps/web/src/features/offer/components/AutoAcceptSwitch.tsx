import { t } from '@/i18n';

interface Props {
  id: string;
  checked: boolean;
  onChange: (next: boolean) => void;
  disabled?: boolean;
  /** Replaces the hint (for example "ride closed"). */
  hint?: string;
  error?: string | null;
}

/** Auto-accept (E8-3): one switch, one sentence on who is confirmed at once. Used on publish and on the driver ride. */
export function AutoAcceptSwitch({ id, checked, onChange, disabled, hint, error }: Props) {
  const hintId = `${id}-hint`;
  return (
    <div className="flex flex-col gap-1">
      <div className="flex min-h-12 items-center justify-between gap-3">
        <label htmlFor={id} className="flex flex-1 flex-col">
          <span className="type-label">{t('offer.autoAccept')}</span>
          <span id={hintId} className="text-sm leading-5 text-text-muted">
            {hint ?? t('offer.autoAccept.hint')}
          </span>
        </label>
        <input
          id={id}
          type="checkbox"
          role="switch"
          className="switch"
          checked={checked}
          disabled={disabled}
          aria-describedby={hintId}
          onChange={(e) => onChange(e.target.checked)}
        />
      </div>
      {error && (
        <p role="alert" className="text-sm leading-5 font-semibold text-error">
          {error}
        </p>
      )}
    </div>
  );
}
