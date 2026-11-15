import { useMemo, useRef, useState, type FormEvent } from 'react';
import type { Place } from '@/api/types';
import { useScreenHeading } from '@/app/useScreenHeading';
import { t } from '@/i18n';
import { dayOptions } from '@/lib/dates';
import { Button } from '@/ui/Button';
import { Icon } from '@/ui/Icon';
import { Notice } from '@/ui/Notice';
import { RouteArt } from '@/ui/RouteArt';
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
      <section className="hero">
        <RouteArt onceKey="find-hero" />
        <img
          src="/brand/logo-reversed.svg"
          alt={t('app.name')}
          width="100"
          height="32"
          className="logo-dk mb-5 h-8 w-auto"
        />
        <img
          src="/brand/logo.svg"
          alt={t('app.name')}
          width="100"
          height="32"
          className="logo-lt mb-5 h-8 w-auto"
        />
        <h1 ref={h1} tabIndex={-1} className="type-display">
          {t('find.title')}
        </h1>
        <p className="mt-2 max-w-[26ch] text-text-muted">{t('find.subtitle')}</p>
      </section>

      <form
        onSubmit={submit}
        noValidate
        className="card relative z-[2] -mt-12 mr-4 mb-4 ml-4 flex flex-col gap-4 p-4"
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
              className="absolute top-1/2 right-2 z-[1] grid size-11 -translate-y-1/2 place-items-center rounded-full border border-border-strong bg-surface text-on-outline"
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
              className="control min-h-12 border border-border-strong"
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
              className={`control min-h-12 ${errors.time ? 'border-2 border-error' : 'border border-border-strong'}`}
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
                className="relative inline-flex min-h-11 cursor-pointer items-center justify-center gap-1 rounded-full border border-border-strong px-1 py-2 font-semibold whitespace-nowrap has-checked:border-outline has-checked:bg-tint has-checked:text-on-tint has-focus-visible:outline-3 has-focus-visible:outline-offset-2 has-focus-visible:outline-focus-ring"
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
