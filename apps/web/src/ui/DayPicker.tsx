import { useState, type ReactNode, type Ref } from 'react';
import { t } from '@/i18n';
import { dateLabel, type DayOption } from '@/lib/dates';
import { PickerField } from './PickerField';
import { WheelColumn, WheelSheet } from './WheelPicker';

interface Props {
  id: string;
  label: string;
  /** 'YYYY-MM-DD' (Europe/Bucharest calendar day). */
  value: string;
  onChange: (value: string) => void;
  /** The days on the wheel, in order (Today, Tomorrow, 'Mon 24 Nov', ...). */
  options: DayOption[];
  hint?: ReactNode;
  error?: string | undefined;
  ref?: Ref<HTMLButtonElement>;
}

/**
 * Day field: the shared trigger plus a one-wheel sheet (alarm style). Same value format as the select it replaced
 * (YYYY-MM-DD), so forms, search state and the API do not change. A value that is not on the wheel (an old ride being
 * edited) is still shown on the trigger; the wheel then opens on its first day.
 */
export function DayPicker({ id, label, value, onChange, options, hint, error, ref }: Props) {
  const [open, setOpen] = useState(false);
  const shown = options.find((o) => o.value === value)?.label ?? (value ? dateLabel(value) : '');
  return (
    <PickerField
      id={id}
      ref={ref}
      label={label}
      display={shown}
      placeholder={t('time.placeholder')}
      icon="calendar"
      onOpen={() => setOpen(true)}
      hint={hint}
      error={error}
    >
      <WheelSheet
        open={open}
        title={label}
        onClose={() => setOpen(false)}
        init={() => (options.some((o) => o.value === value) ? value : (options[0]?.value ?? ''))}
        summary={(d) => options.find((o) => o.value === d)?.label ?? ''}
        isValid={(d) => d !== ''}
        confirmLabel={t('day.confirm')}
        onConfirm={(d) => {
          onChange(d);
          setOpen(false);
        }}
      >
        {(draft, setDraft, confirm) => (
          <WheelColumn
            id={`${id}-wheel`}
            label={t('wheel.day')}
            size="md"
            items={options}
            value={draft}
            onChange={setDraft}
            onEnter={confirm}
            autoFocus
          />
        )}
      </WheelSheet>
    </PickerField>
  );
}
