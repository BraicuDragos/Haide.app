import { useScreenHeading } from '@/app/useScreenHeading';
import { t } from '@/i18n';
import { Icon } from './Icon';

/**
 * Sticky screen title bar. Owns the single h1 of the screen, the document title and focus-on-navigate.
 * `onBack` adds a 48 px back button for deeper screens; `onClose` swaps it for a close button (sign-in).
 */
export function PageHeader({
  title,
  onBack,
  onClose,
}: {
  title: string;
  onBack?: () => void;
  onClose?: () => void;
}) {
  const ref = useScreenHeading(title);
  const lead = onClose ?? onBack;
  return (
    <header
      className={`sticky top-0 z-10 flex min-h-14 items-center gap-1 border-b border-(color:--hair) bg-bg pr-4 ${lead ? 'pl-1' : 'pl-4'}`}
    >
      {lead && (
        <button
          type="button"
          onClick={lead}
          aria-label={onClose ? t('common.close') : t('common.back')}
          className="grid size-12 flex-none place-items-center rounded-full hover:bg-surface-subtle"
        >
          <Icon name={onClose ? 'close' : 'back'} />
        </button>
      )}
      <h1 ref={ref} tabIndex={-1} className="type-h3">
        {title}
      </h1>
    </header>
  );
}
