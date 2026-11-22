import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useEffect, useId, useState } from 'react';
import { dismissReport, suspendUser, unsuspendUser, type AdminReport } from '@/api/admin';
import { ApiError } from '@/api/client';
import { keys } from '@/api/keys';
import type { ReportReason } from '@/api/types';
import { t, tError } from '@/i18n';
import { Button } from '@/ui/Button';
import { SelectField, TextArea } from '@/ui/Field';
import { Notice } from '@/ui/Notice';
import { Sheet } from '@/ui/Sheet';
import { useToast } from '@/ui/Toast';
import { REASON_CODES, reasonLabel } from '../format';

export type AdminAction =
  | { kind: 'dismiss'; report: AdminReport }
  | { kind: 'suspend'; report?: AdminReport; user: { id: string; firstName: string | null } }
  | { kind: 'unsuspend'; user: { id: string; firstName: string | null } };

export const STATEMENT_MIN = 10;
export const STATEMENT_MAX = 300;
export const NOTE_MAX = 200;

const TITLE = {
  dismiss: 'admin.sheet.dismiss.title',
  suspend: 'admin.sheet.suspend.title',
  unsuspend: 'admin.sheet.unsuspend.title',
} as const;

/** The confirmation sheet for the three audited actions. Every action is confirmed here, never one tap. */
export function AdminActionSheet({
  action,
  onClose,
}: {
  action: AdminAction | null;
  onClose: () => void;
}) {
  // Keep the last action while the sheet closes, so the panel does not collapse mid-animation.
  const [shown, setShown] = useState<AdminAction | null>(action);
  useEffect(() => {
    if (action) setShown(action);
  }, [action]);
  const a = action ?? shown;
  return (
    <Sheet
      open={action !== null}
      title={a ? t(TITLE[a.kind], { name: nameOf(a) }) : ''}
      onClose={onClose}
    >
      {a && <Body key={`${a.kind}-${idOf(a)}`} action={a} onClose={onClose} />}
    </Sheet>
  );
}

const nameOf = (a: AdminAction) =>
  a.kind === 'dismiss'
    ? (a.report.reported.firstName ?? t('admin.deletedUser'))
    : (a.user.firstName ?? t('admin.deletedUser'));
const idOf = (a: AdminAction) => (a.kind === 'dismiss' ? a.report.id : a.user.id);

function Body({ action, onClose }: { action: AdminAction; onClose: () => void }) {
  const id = useId();
  const qc = useQueryClient();
  const toast = useToast();
  const [note, setNote] = useState('');
  const [statement, setStatement] = useState('');
  const [reason, setReason] = useState<ReportReason>(
    action.kind === 'suspend' && action.report ? action.report.reason : 'other',
  );
  const [touched, setTouched] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const run = useMutation({
    mutationFn: async () => {
      if (action.kind === 'dismiss')
        return dismissReport(action.report.id, note.trim() || undefined);
      if (action.kind === 'unsuspend')
        return unsuspendUser(action.user.id, note.trim() || undefined);
      return suspendUser(action.user.id, {
        reasonCode: reason,
        statement: statement.trim().normalize('NFC'),
        ...(action.report ? { reportId: action.report.id } : {}),
      });
    },
    onSuccess: async () => {
      toast.show(
        t(
          action.kind === 'dismiss'
            ? 'admin.toast.dismissed'
            : action.kind === 'suspend'
              ? 'admin.toast.suspended'
              : 'admin.toast.unsuspended',
        ),
      );
      await qc.invalidateQueries({ queryKey: keys.admin.all });
      onClose();
    },
    onError: async (err) => {
      const code = err instanceof ApiError ? err.code : undefined;
      if (code === 'INVALID_STATE') {
        // Someone else got there first: say so, show the current state, close.
        toast.show(t('admin.toast.stale'));
        await qc.invalidateQueries({ queryKey: keys.admin.all });
        onClose();
        return;
      }
      // The server refuses a statement with contact details: say so instead of a generic message.
      if (err instanceof ApiError && err.fields?.statement === 'contact_details') {
        setError(t('admin.suspend.contactDetails'));
        return;
      }
      // The server never suspends an admin account (fields.userId = 'admin').
      if (err instanceof ApiError && err.fields?.userId === 'admin') {
        setError(t('admin.suspend.adminTarget'));
        return;
      }
      setError(tError(code));
    },
  });

  const len = statement.trim().length;
  const statementError =
    touched && action.kind === 'suspend' && (len < STATEMENT_MIN || len > STATEMENT_MAX)
      ? t('admin.suspend.statementError', { min: STATEMENT_MIN, max: STATEMENT_MAX })
      : undefined;

  function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (action.kind === 'suspend') {
      setTouched(true);
      if (len < STATEMENT_MIN || len > STATEMENT_MAX) return;
    }
    run.mutate();
  }

  return (
    <form onSubmit={submit} noValidate className="flex flex-1 flex-col gap-4">
      <p className="text-text-muted">
        {t(`admin.sheet.${action.kind}.body`, { name: nameOf(action) })}
      </p>
      {action.kind === 'suspend' ? (
        <>
          <SelectField
            id={`${id}-reason`}
            label={t('admin.suspend.reason')}
            value={reason}
            onChange={(e) => setReason(e.target.value as ReportReason)}
          >
            {REASON_CODES.map((c) => (
              <option key={c} value={c}>
                {reasonLabel(c)}
              </option>
            ))}
          </SelectField>
          <TextArea
            id={`${id}-statement`}
            label={t('admin.suspend.statement')}
            hint={t('admin.suspend.statementHint')}
            error={statementError}
            value={statement}
            maxLength={STATEMENT_MAX + 50}
            onChange={(e) => setStatement(e.target.value)}
          />
          <p className="-mt-2 text-sm leading-5 text-text-muted" aria-live="polite">
            {t('admin.suspend.counter', { n: len, max: STATEMENT_MAX })}
          </p>
        </>
      ) : (
        <TextArea
          id={`${id}-note`}
          label={t('admin.note')}
          optional
          value={note}
          maxLength={NOTE_MAX}
          onChange={(e) => setNote(e.target.value)}
        />
      )}
      {error && <Notice tone="error">{error}</Notice>}
      <div className="mt-auto flex flex-col gap-3 pt-2">
        <Button
          type="submit"
          variant={action.kind === 'suspend' ? 'danger' : 'primary'}
          block
          loading={run.isPending}
        >
          {t(`admin.sheet.${action.kind}.confirm`)}
        </Button>
        <Button variant="ghost" block onClick={onClose} disabled={run.isPending}>
          {t('admin.sheet.cancel')}
        </Button>
      </div>
    </form>
  );
}
