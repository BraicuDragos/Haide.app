import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Link } from 'react-router';
import { ApiError } from '@/api/client';
import { keys } from '@/api/keys';
import { postAlert, type AlertInput } from '@/api/liquidity';
import { t, tError } from '@/i18n';
import { bucharestToIso, dateLabel } from '@/lib/dates';
import { isoWeekday } from '@/lib/seriesDates';
import { Button } from '@/ui/Button';
import { Notice } from '@/ui/Notice';
import { Sheet } from '@/ui/Sheet';
import { useToast } from '@/ui/Toast';
import { toPoint, type SearchCriteria } from '@/features/find/searchState';

type Kind = 'date' | 'weekly';

interface Props {
  open: boolean;
  onClose: () => void;
  criteria: SearchCriteria;
}

const label = (s: string) => s.normalize('NFC').trim().slice(0, 80);

/**
 * "Notify me about this route" (E8-2): one choice (only on the searched day, or every such weekday), then Save. The
 * places and the time come from the search, so there is nothing else to type. Alerts last 14 days.
 */
export default function NotifyMeSheet({ open, onClose, criteria }: Props) {
  const qc = useQueryClient();
  const toast = useToast();
  const [kind, setKind] = useState<Kind>('date');
  const [code, setCode] = useState<string | null>(null);
  const weekday = isoWeekday(criteria.day);

  const save = useMutation({
    mutationFn: () => {
      const body: AlertInput = {
        from: toPoint(criteria.from.point),
        to: toPoint(criteria.to.point),
        fromLabel: label(criteria.from.name),
        toLabel: label(criteria.to.name),
        schedule:
          kind === 'date'
            ? { kind: 'date', date: criteria.day }
            : { kind: 'weekly', weekdays: [weekday] },
        time: criteria.time,
        windowMin: Number(criteria.win),
      };
      return postAlert(body);
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: keys.alerts });
      toast.show(t('alerts.saved'));
      setCode(null);
      onClose();
    },
    onError: (e) => setCode(e instanceof ApiError ? e.code : 'NETWORK'),
  });

  const when = t('results.when', {
    day: dateLabel(criteria.day),
    time: criteria.time,
    win: t(`find.window.${criteria.win}`),
  });
  const past = new Date(bucharestToIso(criteria.day, criteria.time)).getTime() < Date.now();
  const blocked = past && kind === 'date';

  return (
    <Sheet open={open} title={t('alerts.sheet.title')} onClose={onClose}>
      <p className="font-semibold">
        {t('results.route', { from: criteria.from.name, to: criteria.to.name })}
      </p>
      <p className="-mt-2 text-sm leading-5 text-text-muted">{when}</p>
      <p className="text-text-muted">{t('alerts.sheet.body')}</p>
      <fieldset className="m-0 flex min-w-0 flex-col gap-2 border-0 p-0">
        <legend className="type-label mb-1 p-0">{t('alerts.sheet.when')}</legend>
        {(['date', 'weekly'] as const).map((v) => (
          <label
            key={v}
            className="card flex min-h-12 cursor-pointer items-center gap-3 px-4 py-2 has-[:focus-visible]:outline-3 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-(color:--theme-focus-ring)"
          >
            <input
              type="radio"
              name="alert-kind"
              value={v}
              checked={kind === v}
              onChange={() => setKind(v)}
              className="size-5 accent-(color:--theme-outline)"
            />
            <span className="font-semibold">
              {v === 'date'
                ? t('alerts.sheet.once', { date: dateLabel(criteria.day) })
                : t('alerts.sheet.weekly', { weekday: t(`weekday.${weekday}.long`) })}
            </span>
          </label>
        ))}
      </fieldset>
      {blocked && <Notice tone="warning">{t('alerts.sheet.past')}</Notice>}
      {code && (
        <Notice tone="error">
          <span>{tError(code)}</span>
          {code === 'ALERT_LIMIT' && (
            <>
              {' '}
              <Link className="underline" to="/settings/alerts">
                {t('alerts.limit.link')}
              </Link>
            </>
          )}
        </Notice>
      )}
      <div className="mt-auto flex flex-col gap-3">
        <Button block loading={save.isPending} disabled={blocked} onClick={() => save.mutate()}>
          {t('alerts.sheet.save')}
        </Button>
        <Button variant="secondary" block disabled={save.isPending} onClick={onClose}>
          {t('request.cancel')}
        </Button>
      </div>
    </Sheet>
  );
}
