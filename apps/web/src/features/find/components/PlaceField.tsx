import { forwardRef } from 'react';
import type { Place } from '@/api/types';
import { t } from '@/i18n';

interface Props {
  kind: 'from' | 'to';
  place: Place | null;
  invalid?: boolean;
  describedBy?: string | undefined;
  onOpen: () => void;
}

/** Button that looks like a field and opens the place picker sheet. Shows label, then value or placeholder. */
export const PlaceField = forwardRef<HTMLButtonElement, Props>(function PlaceField(
  { kind, place, invalid, describedBy, onOpen },
  ref,
) {
  return (
    <button
      ref={ref}
      type="button"
      onClick={onOpen}
      aria-haspopup="dialog"
      aria-invalid={invalid || undefined}
      aria-describedby={describedBy}
      className={[
        'flex min-h-14 w-full items-center gap-3 rounded-md bg-surface px-3 py-2 text-left',
        invalid ? 'border-2 border-error' : 'border border-border-strong',
      ].join(' ')}
    >
      <span
        aria-hidden="true"
        className={
          kind === 'from'
            ? 'size-3.5 flex-none rounded-full bg-accent ring-2 ring-primary-700'
            : 'size-3.5 flex-none rounded-full border-[3px] border-primary-700 bg-surface'
        }
      />
      <span className="min-w-0 flex-1 pr-12">
        <span className="block text-sm leading-5 font-semibold text-text-muted">
          {t(kind === 'from' ? 'find.from' : 'find.to')}
        </span>
        <span className={`block truncate text-md leading-6 ${place ? '' : 'text-text-subtle'}`}>
          {place ? place.name : t(kind === 'from' ? 'find.fromPlaceholder' : 'find.toPlaceholder')}
        </span>
      </span>
    </button>
  );
});
