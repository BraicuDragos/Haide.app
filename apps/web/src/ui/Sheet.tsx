import { useEffect, useId, useRef, type ReactNode } from 'react';
import { t } from '@/i18n';
import { Icon } from './Icon';

interface Props {
  open: boolean;
  title: string;
  onClose: () => void;
  children: ReactNode;
}

/**
 * Modal bottom sheet on the native dialog element. showModal() gives the focus trap, the inert background, Esc to
 * close and focus return to the opener (accessibility.md sections 3 and 5). A backdrop click closes it as well and
 * there is always a visible Close button.
 */
export function Sheet({ open, title, onClose, children }: Props) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();

  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);

  return (
    <dialog
      ref={ref}
      aria-labelledby={titleId}
      onClose={(e) => {
        // A sheet nested inside this one (the time picker) fires its own close; React bubbles it up here.
        if (e.target === e.currentTarget) onClose();
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
      className="m-0 mt-auto h-full max-h-none w-full max-w-none bg-transparent p-0 open:flex open:flex-col open:justify-end"
    >
      {open && (
        <div className="sheet-panel mx-auto flex max-h-[92dvh] min-h-[60dvh] w-full max-w-xl flex-col">
          <div
            aria-hidden="true"
            className="mx-auto mt-2 h-1 w-10 flex-none rounded-full bg-border-strong"
          />
          <header className="flex flex-none items-center gap-2 py-2 pr-2 pl-5">
            <h2 id={titleId} className="type-h2 flex-1">
              {title}
            </h2>
            <button
              type="button"
              onClick={onClose}
              aria-label={t('common.close')}
              className="grid size-12 flex-none place-items-center rounded-full hover:bg-surface-subtle"
            >
              <Icon name="close" />
            </button>
          </header>
          <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-5 pt-2 pb-5">
            {children}
          </div>
        </div>
      )}
    </dialog>
  );
}
