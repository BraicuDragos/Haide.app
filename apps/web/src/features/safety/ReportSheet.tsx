import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useEffect, useId, useState } from 'react';
import { useNavigate } from 'react-router';
import { ApiError } from '@/api/client';
import { postReport } from '@/api/safety';
import type { ReportReason } from '@/api/types';
import { t, tError, type MessageKey } from '@/i18n';
import { Button } from '@/ui/Button';
import { TextArea } from '@/ui/Field';
import { Icon } from '@/ui/Icon';
import { Notice } from '@/ui/Notice';
import { Sheet } from '@/ui/Sheet';
import { useToast } from '@/ui/Toast';
import { invalidateAfterSafety } from './invalidate';

const REASONS: Array<{ value: ReportReason; label: MessageKey }> = [
  { value: 'no_show', label: 'report.reason.noShow' },
  { value: 'unsafe_driving', label: 'report.reason.unsafe' },
  { value: 'harassment', label: 'report.reason.harassment' },
  { value: 'extra_money', label: 'report.reason.extraMoney' },
  { value: 'fake_profile', label: 'report.reason.fake' },
  { value: 'other', label: 'report.reason.other' },
];
const MAX = 500;

export interface ReportSheetProps {
  open: boolean;
  onClose: () => void;
  user: { id: string; firstName: string | null };
  /** Opened from a booking: the report is tied to it (the server derives the ride). */
  bookingId?: string;
  rideId?: string;
}

/**
 * Report (5.2): reason, details (required for Other) and "also block". The reported person is never told. With
 * "also block" the person leaves for My rides (the profile is gone for them now); otherwise the sheet says it was sent.
 */
export default function ReportSheet({ open, onClose, user, bookingId, rideId }: ReportSheetProps) {
  const qc = useQueryClient();
  const toast = useToast();
  const navigate = useNavigate();
  const uid = useId();
  const [reason, setReason] = useState<ReportReason | null>(null);
  const [details, setDetails] = useState('');
  const [alsoBlock, setAlsoBlock] = useState(false);
  const [problem, setProblem] = useState<{ reason?: string; details?: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);
  const name = user.firstName ?? t('pub.deleted');

  // A fresh form every time the sheet opens.
  useEffect(() => {
    if (!open) return;
    setReason(null);
    setDetails('');
    setAlsoBlock(false);
    setProblem(null);
    setError(null);
    setSent(false);
  }, [open]);

  const send = useMutation({
    mutationFn: () =>
      postReport({
        reportedUserId: user.id,
        reason: reason as ReportReason,
        ...(details.trim() ? { details: details.trim() } : {}),
        ...(bookingId ? { bookingId } : {}),
        ...(rideId && !bookingId ? { rideId } : {}),
        ...(alsoBlock ? { alsoBlock: true } : {}),
      }),
    onSuccess: () => {
      toast.show(t('report.toast'));
      if (alsoBlock) {
        invalidateAfterSafety(qc, { userId: user.id, ...(bookingId ? { bookingId } : {}) });
        onClose();
        void navigate('/rides', { replace: true });
      } else {
        setSent(true);
      }
    },
    onError: (err) => {
      if (err instanceof ApiError && err.code === 'VALIDATION_FAILED' && err.fields?.details)
        setProblem({ details: t('report.details.required') });
      else setError(tError(err instanceof ApiError ? err.code : 'NETWORK'));
    },
  });

  const close = () => {
    if (!send.isPending) onClose();
  };

  function submit() {
    const next: { reason?: string; details?: string } = {};
    if (!reason) next.reason = t('report.err');
    else if (reason === 'other' && details.trim().length === 0)
      next.details = t('report.details.required');
    setProblem(Object.keys(next).length ? next : null);
    setError(null);
    if (Object.keys(next).length === 0) send.mutate();
  }

  return (
    <Sheet
      open={open}
      title={sent ? t('report.sent.title') : t('report.title', { name })}
      onClose={close}
    >
      {sent ? (
        <>
          <p className="flex items-start gap-2">
            <Icon name="done" className="mt-0.5 text-savings" />
            <span>{t('report.sent.body')}</span>
          </p>
          <div className="mt-auto">
            <Button block onClick={onClose}>
              {t('common.done')}
            </Button>
          </div>
        </>
      ) : (
        <form
          noValidate
          className="flex min-h-0 flex-1 flex-col gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            submit();
          }}
        >
          <p className="text-text-muted">{t('report.body', { name })}</p>
          <fieldset
            aria-describedby={problem?.reason ? `${uid}-reason-err` : undefined}
            className="m-0 flex min-w-0 flex-col gap-1 border-0 p-0"
          >
            <legend className="type-label mb-1 p-0">{t('report.reason')}</legend>
            {REASONS.map((r) => (
              <label
                key={r.value}
                className="flex min-h-12 cursor-pointer items-center gap-3 rounded-md px-1"
              >
                <input
                  type="radio"
                  name={`${uid}-reason`}
                  value={r.value}
                  checked={reason === r.value}
                  onChange={() => {
                    setReason(r.value);
                    setProblem(null);
                  }}
                  className="size-6 flex-none accent-action"
                />
                <span>{t(r.label)}</span>
              </label>
            ))}
            {problem?.reason && (
              <p
                id={`${uid}-reason-err`}
                role="alert"
                className="flex items-start gap-1.5 text-sm leading-5 font-semibold text-error"
              >
                <Icon name="alert" small className="mt-0.5" />
                {problem.reason}
              </p>
            )}
          </fieldset>
          <TextArea
            id={`${uid}-details`}
            label={t('report.details')}
            optional={reason !== 'other'}
            maxLength={MAX}
            value={details}
            onChange={(e) => setDetails(e.target.value)}
            hint={t('report.details.hint', { n: details.length })}
            error={problem?.details}
          />
          <div className="flex min-h-12 items-center gap-3">
            <input
              id={`${uid}-block`}
              type="checkbox"
              checked={alsoBlock}
              onChange={(e) => setAlsoBlock(e.target.checked)}
              className="size-6 flex-none accent-action"
            />
            <label htmlFor={`${uid}-block`} className="flex-1 leading-6">
              {t('report.alsoBlock', { name })}
            </label>
          </div>
          {error && <Notice tone="error">{error}</Notice>}
          <div className="mt-auto flex flex-col gap-3">
            <Button type="submit" block loading={send.isPending}>
              {t('report.send')}
            </Button>
          </div>
        </form>
      )}
    </Sheet>
  );
}
