import { useMemo, useRef, useState, type FormEvent } from 'react';
import type { Place } from '@/api/types';
import { useScreenHeading } from '@/app/useScreenHeading';
import { t } from '@/i18n';
import { dayOptions } from '@/lib/dates';
import { Button } from '@/ui/Button';
import { Icon } from '@/ui/Icon';
import { Notice } from '@/ui/Notice';
import { PlaceField } from '../components/PlaceField';
import { PlacePickerSheet, type PickerKind } from '../components/PlacePickerSheet';

type Window = '15' | '30' | '60';
type Errors = { places?: string; time?: string };

const WINDOWS: Window[] = ['15', '30', '60'];

/**
 * Find root (ia-and-flows 4, E3-1). E0 scope: the form, the place picker and validation. The results screen is E3,
 * so a valid submit only confirms the places for now.
 */
export function FindScreen() {
  const h1 = useScreenHeading(t('find.title'));
  const days = useMemo(() => dayOptions(7), []);

  const [from, setFrom] = useState<Place | null>(null);
  const [to, setTo] = useState<Place | null>(null);
  const [day, setDay] = useState(days[0]?.value ?? '');
  const [time, setTime] = useState('');
  const [win, setWin] = useState<Window>('30');
  const [picker, setPicker] = useState<PickerKind | null>(null);
  const [errors, setErrors] = useState<Errors>({});
  const [ready, setReady] = useState(false);

  const fromBtn = useRef<HTMLButtonElement>(null);
  const toBtn = useRef<HTMLButtonElement>(null);
  const timeInput = useRef<HTMLInputElement>(null);

  function pick(place: Place) {
    if (picker === 'from') setFrom(place);
    else setTo(place);
    setPicker(null);
    setReady(false);
    setErrors((e) => ({ ...e, places: undefined }));
  }

  function swap() {
    setFrom(to);
    setTo(from);
    setReady(false);
  }

  function submit(e: FormEvent) {
    e.preventDefault();
    const next: Errors = {};
    if (!from || !to) next.places = t('find.err.missing');
    else if (from.id === to.id) next.places = t('find.err.same');
    if (!time) next.time = t('find.err.timeMissing');
    setErrors(next);
    setReady(false);
    if (next.places) (!from ? fromBtn : !to ? toBtn : fromBtn).current?.focus();
    else if (next.time) timeInput.current?.focus();
    else setReady(true);
  }

  return (
    <>
      <section className="relative overflow-hidden bg-primary-900 px-4 pt-5 pb-14 text-white">
        <img
          src="/brand/logo-reversed.svg"
          alt={t('app.name')}
          width="100"
          height="32"
          className="mb-5 h-8 w-auto"
        />
        <h1 ref={h1} tabIndex={-1} className="type-h1 max-w-[12ch]">
          {t('find.title')}
        </h1>
        <p className="mt-1 max-w-[30ch] text-primary-200">{t('find.subtitle')}</p>
        <svg
          viewBox="0 0 150 110"
          aria-hidden="true"
          focusable="false"
          className="pointer-events-none absolute right-[-8px] bottom-0 h-[110px] w-[150px] opacity-90"
        >
          <path
            d="M8 102C40 102 52 64 82 58S124 44 138 14"
            fill="none"
            stroke="var(--color-primary-400)"
            strokeWidth="5"
            strokeLinecap="round"
          />
          <circle cx="138" cy="14" r="7" fill="var(--color-accent)" />
          <circle
            cx="8"
            cy="102"
            r="6"
            fill="var(--color-primary-900)"
            stroke="var(--color-primary-300)"
            strokeWidth="3"
          />
        </svg>
      </section>

      <form
        onSubmit={submit}
        noValidate
        className="relative -mt-10 mr-4 mb-4 ml-4 flex flex-col gap-4 rounded-md border border-border bg-surface p-4 shadow-card"
      >
        <div className="flex flex-col gap-2">
          <div className="relative flex flex-col gap-2">
            <PlaceField
              ref={fromBtn}
              kind="from"
              place={from}
              invalid={Boolean(errors.places) && !from}
              describedBy={errors.places ? 'places-err' : undefined}
              onOpen={() => setPicker('from')}
            />
            <PlaceField
              ref={toBtn}
              kind="to"
              place={to}
              invalid={Boolean(errors.places) && (!to || from?.id === to.id)}
              describedBy={errors.places ? 'places-err' : undefined}
              onOpen={() => setPicker('to')}
            />
            <button
              type="button"
              onClick={swap}
              aria-label={t('find.swap')}
              className="absolute top-1/2 right-2 z-[1] grid size-11 -translate-y-1/2 place-items-center rounded-full border border-border-strong bg-surface text-primary-700"
            >
              <Icon name="swap" />
            </button>
          </div>
          {errors.places && (
            <p
              id="places-err"
              role="alert"
              className="flex items-start gap-1.5 text-sm leading-5 font-semibold text-error"
            >
              <Icon name="alert" small className="mt-0.5" />
              {errors.places}
            </p>
          )}
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div className="flex flex-col gap-1">
            <label htmlFor="find-day" className="type-label">
              {t('find.day')}
            </label>
            <select
              id="find-day"
              value={day}
              onChange={(e) => setDay(e.target.value)}
              className="min-h-12 w-full rounded-md border border-border-strong bg-surface px-3 text-md"
            >
              {days.map((d) => (
                <option key={d.value} value={d.value}>
                  {d.label}
                </option>
              ))}
            </select>
          </div>
          <div className="flex flex-col gap-1">
            <label htmlFor="find-time" className="type-label">
              {t('find.time')}
            </label>
            <input
              id="find-time"
              ref={timeInput}
              type="time"
              value={time}
              onChange={(e) => setTime(e.target.value)}
              aria-invalid={errors.time ? true : undefined}
              aria-describedby={errors.time ? 'time-err' : undefined}
              className={`min-h-12 w-full rounded-md bg-surface px-3 text-md ${errors.time ? 'border-2 border-error' : 'border border-border-strong'}`}
            />
          </div>
        </div>
        {errors.time && (
          <p
            id="time-err"
            role="alert"
            className="-mt-2 flex items-start gap-1.5 text-sm leading-5 font-semibold text-error"
          >
            <Icon name="alert" small className="mt-0.5" />
            {errors.time}
          </p>
        )}

        <fieldset className="m-0 min-w-0 border-0 p-0">
          <legend className="type-label mb-1 p-0">{t('find.window')}</legend>
          <div className="grid grid-cols-3 gap-1.5">
            {WINDOWS.map((w) => (
              <label
                key={w}
                className="relative inline-flex min-h-11 cursor-pointer items-center justify-center gap-1 rounded-full border border-border-strong bg-surface px-1 py-2 font-semibold whitespace-nowrap has-checked:border-action has-checked:bg-tint has-checked:text-on-tint has-focus-visible:outline-3 has-focus-visible:outline-offset-2 has-focus-visible:outline-focus-ring"
              >
                <input
                  type="radio"
                  name="window"
                  value={w}
                  checked={win === w}
                  onChange={() => setWin(w)}
                  className="peer absolute inset-0 m-0 size-full cursor-pointer opacity-0"
                />
                <Icon name="check" small className="hidden peer-checked:block" />
                {t(`find.window.${w}`)}
              </label>
            ))}
          </div>
        </fieldset>

        {ready && <Notice tone="info">{t('find.soon')}</Notice>}

        <Button type="submit" block icon={<Icon name="search" />}>
          {t('find.cta')}
        </Button>
        <p className="text-center text-sm leading-5 text-text-muted">{t('find.visitorHint')}</p>
      </form>

      <PlacePickerSheet
        open={picker !== null}
        kind={picker ?? 'from'}
        onSelect={pick}
        onClose={() => setPicker(null)}
      />
    </>
  );
}
