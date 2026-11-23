import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router';
import { ApiError } from '@/api/client';
import { keys } from '@/api/keys';
import { getVehicle } from '@/api/account';
import { postSeries, type SeriesCreated } from '@/api/liquidity';
import { postRide, postRidePreview, toPreviewRequest } from '@/api/rides';
import type { Place, RoutePreview } from '@/api/types';
import { t, tError, tp } from '@/i18n';
import { bucharestToday, bucharestToIso, dateLabel, dayOptions } from '@/lib/dates';
import { formatRon } from '@/lib/format';
import { addDays, isoWeekday, SERIES_MAX_DAYS, seriesDates } from '@/lib/seriesDates';
import { triggerPushPrompt } from '@/features/push/trigger';
import { ApproxHint } from '@/features/find/components/ApproxBadge';
import { joinIds } from '@/features/find/placeApprox';
import { PlaceField } from '@/features/find/components/PlaceField';
import { PlacePickerSheet, type PickerKind } from '@/features/find/components/PlacePickerSheet';
import { PriceTable } from '@/features/rides/components/PriceTable';
import { Button } from '@/ui/Button';
import { SelectField, TextArea } from '@/ui/Field';
import { TimePicker } from '@/ui/TimePicker';
import { minTimeFor } from '@/lib/timeSlots';
import { Icon } from '@/ui/Icon';
import { LaunchButton, type LaunchResult } from '@/ui/LaunchButton';
import { Loader, MiniLoader } from '@/ui/Loader';
import { Notice } from '@/ui/Notice';
import { PriceRoll } from '@/ui/PriceRoll';
import { SeatPicker } from '@/ui/SeatPicker';
import { AutoAcceptSwitch } from './AutoAcceptSwitch';
import { RepeatFields, type RepeatValue } from './RepeatFields';
import { classifyPreviewError, classifyPublishError, type PublishFailure } from '../offerErrors';

const MIN_LEAD_MS = 15 * 60_000;
const MAX_LEAD_MS = 14 * 24 * 3_600_000;
const NOTE_MAX = 200;

type PreviewState =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'ok'; data: RoutePreview }
  | { status: 'error'; code: string };

type Field = 'places' | 'time' | 'seats' | 'note' | 'repeat';
type Errors = Partial<Record<Field, string>>;

/** Local validation failed: the inline errors are already set, the launch must not leave. */
class LocalInvalid extends Error {}

const bani = (n: number) => (n / 100).toFixed(2);

/**
 * Publish form (screen 2.2). From and To use the existing place picker; the route preview (distance, time, price
 * table) is requested as soon as both places differ. The price is never editable: the driver only chooses seats and
 * can switch to free. Time and distance rules are mirrored for fast feedback, the server stays the authority and
 * every 400/409 code lands inline next to the field it concerns.
 */
export function PublishForm() {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const days = useMemo(() => dayOptions(15), []);
  const vehicle = useQuery({
    queryKey: keys.vehicle,
    queryFn: ({ signal }) => getVehicle(signal),
  });

  const [from, setFrom] = useState<Place | null>(null);
  const [to, setTo] = useState<Place | null>(null);
  const [picker, setPicker] = useState<PickerKind | null>(null);
  const [preview, setPreview] = useState<PreviewState>({ status: 'idle' });
  const [attempt, setAttempt] = useState(0);
  const [day, setDay] = useState(days[0]?.value ?? '');
  const [time, setTime] = useState('07:30');
  const [seatsChoice, setSeatsChoice] = useState(0);
  const [note, setNote] = useState('');
  const [free, setFree] = useState(false);
  const [autoAccept, setAutoAccept] = useState(false);
  const [repeat, setRepeat] = useState<RepeatValue>({ on: false, weekdays: [], until: '' });
  const [errors, setErrors] = useState<Errors>({});
  const [banner, setBanner] = useState<string | null>(null);
  const [expiredNote, setExpiredNote] = useState(false);

  const fromBtn = useRef<HTMLButtonElement>(null);
  const toBtn = useRef<HTMLButtonElement>(null);
  const timeInput = useRef<HTMLButtonElement>(null);
  const created = useRef<string | null>(null);
  const createdSeries = useRef<SeriesCreated | null>(null);

  const same = Boolean(from && to && from.id === to.id);
  const maxSeats = vehicle.data?.seats ?? 0;
  const seats = Math.min(seatsChoice || Math.min(3, maxSeats), maxSeats);

  // Route preview: whenever the two places change (or Try again). Stale answers are aborted.
  useEffect(() => {
    if (!from || !to || same) {
      setPreview({ status: 'idle' });
      return;
    }
    const ctl = new AbortController();
    setPreview({ status: 'loading' });
    postRidePreview(toPreviewRequest(from, to), ctl.signal)
      .then((data) => setPreview({ status: 'ok', data }))
      .catch((err: unknown) => {
        if (ctl.signal.aborted) return;
        setPreview({ status: 'error', code: err instanceof ApiError ? err.code : 'NETWORK' });
      });
    return () => ctl.abort();
  }, [from, to, same, attempt]);

  function pick(place: Place) {
    if (picker === 'from') setFrom(place);
    else setTo(place);
    setPicker(null);
    setErrors((e) => ({ ...e, places: undefined }));
    setBanner(null);
    setExpiredNote(false);
  }

  // Series window: the first ride is the chosen day, the last one at most 28 days from today.
  const today = bucharestToday();
  const maxUntil = addDays(today, SERIES_MAX_DAYS);
  const until = repeat.until || maxUntil;
  const seriesCount = repeat.on ? seriesDates(day, until, repeat.weekdays).length : 0;

  const previewFail = preview.status === 'error' ? classifyPreviewError(preview.code) : null;
  const placesError = same ? t('offer.err.same') : (errors.places ?? previewFail?.places);
  const data = preview.status === 'ok' ? preview.data : null;
  const row = data?.priceTable.find((r) => r.passengers === seats);

  function validate(): void {
    const next: Errors = {};
    if (!from || !to) next.places = t('offer.err.places');
    else if (same) next.places = t('offer.err.same');
    else if (previewFail?.places) next.places = previewFail.places;
    const lead = new Date(bucharestToIso(day, time || '00:00')).getTime() - Date.now();
    if (!time || lead < MIN_LEAD_MS) next.time = t('offer.err.time');
    else if (lead > MAX_LEAD_MS) next.time = t('offer.err.timeFar');
    if (repeat.on) {
      if (repeat.weekdays.length === 0) next.repeat = t('offer.repeat.err.days');
      else if (until < day) next.repeat = t('offer.repeat.err.endBefore');
      else if (until > maxUntil) next.repeat = t('offer.repeat.err.end');
      else if (seriesCount === 0) next.repeat = t('offer.repeat.err.none');
    }
    setErrors(next);
    if (next.places) (!from ? fromBtn : !to ? toBtn : fromBtn).current?.focus();
    else if (next.time) timeInput.current?.focus();
    else if (next.repeat) document.getElementById('offer-until')?.focus();
    if (Object.keys(next).length) throw new LocalInvalid();
    // both places are fine but the price is still being worked out (the loader or Try again is already showing)
    if (!data) throw new LocalInvalid();
  }

  async function launch(): Promise<LaunchResult> {
    setBanner(null);
    setExpiredNote(false);
    validate();
    if (!navigator.onLine) throw new ApiError({ code: 'OFFLINE', status: 0 });
    if (repeat.on) {
      const result = await postSeries({
        previewId: data!.previewId,
        weekdays: repeat.weekdays,
        departureTime: time,
        startsOn: day,
        endsOn: until,
        seats,
        ...(note.trim() ? { note: note.trim() } : {}),
        isFree: free,
        autoAccept,
      });
      createdSeries.current = result;
      created.current = result.created[0]?.rideId ?? null;
      void qc.invalidateQueries({ queryKey: keys.rides.all });
      return 'sent';
    }
    const ride = await postRide({
      previewId: data!.previewId,
      departureAt: bucharestToIso(day, time),
      seats,
      ...(note.trim() ? { note: note.trim() } : {}),
      isFree: free,
      autoAccept,
    });
    created.current = ride.id;
    qc.setQueryData(keys.rides.mine(ride.id), ride);
    void qc.invalidateQueries({ queryKey: keys.rides.all });
    return 'sent';
  }

  function fail(err: unknown) {
    if (err instanceof LocalInvalid) return;
    const f: PublishFailure = classifyPublishError(err, {
      seats: maxSeats,
      day: dateLabel(day),
      series: repeat.on,
    });
    if (f.field === 'time') {
      setErrors({ time: f.message });
      timeInput.current?.focus();
    } else if (f.field === 'seats') {
      setErrors({ seats: f.message });
      void qc.invalidateQueries({ queryKey: keys.vehicle });
    } else if (f.field === 'note') setErrors({ note: f.message });
    else if (f.field === 'repeat') setErrors({ repeat: f.message });
    else if (!f.refreshPreview) setBanner(f.message);
    if (f.refreshPreview) {
      setExpiredNote(true);
      setAttempt((a) => a + 1);
    }
    if (f.refreshAccount) void qc.invalidateQueries({ queryKey: keys.me });
  }

  if (vehicle.isPending)
    return (
      <div aria-busy="true">
        <Loader />
      </div>
    );
  if (vehicle.isError || !vehicle.data)
    return (
      <div className="flex flex-col gap-3 p-4">
        <Notice tone="error">
          {tError(vehicle.error instanceof ApiError ? vehicle.error.code : undefined)}
        </Notice>
        <Button variant="secondary" onClick={() => void vehicle.refetch()}>
          {t('common.retry')}
        </Button>
      </div>
    );

  const fuelLabel = t(`vehicle.fuel.${vehicle.data.fuelType}`);
  const km = data ? (data.distanceM / 1000).toFixed(1) : '';
  const rows = data?.priceTable.slice(0, maxSeats) ?? [];

  return (
    <form
      onSubmit={(e) => e.preventDefault()}
      noValidate
      className="flex flex-col gap-5 px-4 pt-4 pb-6"
    >
      <p className="text-text-muted">{t('offer.subtitle')}</p>

      <div className="flex flex-col gap-2">
        <PlaceField
          ref={fromBtn}
          kind="from"
          place={from}
          invalid={Boolean(placesError) && !from}
          describedBy={joinIds(
            placesError && 'offer-places-err',
            from?.approximate === true && 'offer-from-approx',
          )}
          onOpen={() => setPicker('from')}
        />
        {from?.approximate === true && <ApproxHint id="offer-from-approx" kind="from" />}
        <PlaceField
          ref={toBtn}
          kind="to"
          place={to}
          invalid={Boolean(placesError) && (!to || same || Boolean(previewFail?.places))}
          describedBy={joinIds(
            placesError && 'offer-places-err',
            to?.approximate === true && 'offer-to-approx',
          )}
          onOpen={() => setPicker('to')}
        />
        {to?.approximate === true && <ApproxHint id="offer-to-approx" kind="to" />}
        {placesError && (
          <p
            id="offer-places-err"
            role="alert"
            className="flex items-start gap-1.5 text-sm leading-5 font-semibold text-error"
          >
            <Icon name="alert" small className="mt-0.5" />
            {placesError}
          </p>
        )}
      </div>

      <div aria-live="polite" className="empty:hidden">
        {preview.status === 'loading' && <MiniLoader label={t('offer.route.loading')} />}
        {data && (
          <p className="flex items-center gap-2 font-semibold">
            <Icon name="car" />
            {t('offer.route.result', { km, min: Math.max(1, Math.round(data.durationS / 60)) })}
          </p>
        )}
      </div>
      {preview.status === 'error' && previewFail && !previewFail.places && (
        <div className="flex flex-col items-start gap-2">
          <Notice tone="error">{previewFail.message}</Notice>
          <Button variant="secondary" onClick={() => setAttempt((a) => a + 1)}>
            {t('offer.route.retry')}
          </Button>
        </div>
      )}

      <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)] gap-3">
        <SelectField
          id="offer-day"
          label={t('offer.day')}
          value={day}
          onChange={(e) => {
            setDay(e.target.value);
            setErrors((x) => ({ ...x, time: undefined }));
            setBanner(null);
          }}
        >
          {days.map((d) => (
            <option key={d.value} value={d.value}>
              {d.label}
            </option>
          ))}
        </SelectField>
        <TimePicker
          id="offer-time"
          ref={timeInput}
          label={t('offer.time')}
          value={time}
          minTime={() => minTimeFor(day, MIN_LEAD_MS)}
          error={errors.time}
          onChange={(v) => {
            setTime(v);
            setErrors((x) => ({ ...x, time: undefined }));
          }}
        />
      </div>

      <div className="flex flex-col gap-3">
        <SeatPicker
          max={maxSeats}
          value={seats}
          legend={t('offer.seats')}
          hint={t('offer.seats.hint', { n: maxSeats })}
          seatLabel={(n) => tp('offer.seats.value', n)}
          onChange={(n) => {
            setSeatsChoice(n);
            setErrors((x) => ({ ...x, seats: undefined }));
          }}
        />
        {errors.seats && (
          <p role="alert" className="flex items-start gap-1.5 text-sm font-semibold text-error">
            <Icon name="alert" small className="mt-0.5" />
            {errors.seats}
          </p>
        )}
        {row && (
          <div className="flex items-end justify-between gap-4">
            <p className="type-numeral-sm" aria-hidden="true">
              {seats}{' '}
              <span className="text-base font-normal text-text-muted">
                {tp('offer.seats.value', seats).replace(/^\d+\s*/, '')}
              </span>
            </p>
            <div className="text-right">
              <p className="text-sm leading-5 text-text-muted">{t('detail.priceTable.col2')}</p>
              <p className="type-price text-price">
                {free ? (
                  t('common.free')
                ) : (
                  <>
                    <PriceRoll
                      value={bani(row.priceBani)}
                      label={formatRon(row.priceBani)}
                      animate
                    />{' '}
                    <span aria-hidden="true" className="type-body text-text-muted">
                      RON
                    </span>
                  </>
                )}
              </p>
            </div>
          </div>
        )}
      </div>

      <TextArea
        id="offer-note"
        label={t('offer.note')}
        optional
        rows={2}
        maxLength={NOTE_MAX}
        placeholder={t('offer.note.placeholder')}
        hint={t('offer.note.hint', { n: note.length })}
        error={errors.note}
        value={note}
        onChange={(e) => setNote(e.target.value)}
      />

      <section aria-labelledby="offer-price-h" className="card flex flex-col gap-3 p-4">
        <h2 id="offer-price-h" className="type-h3">
          {t('offer.price.title')}
        </h2>
        <p className="text-sm leading-5 text-text-muted">{t('offer.price.body')}</p>
        {data ? (
          <>
            <PriceTable
              rows={rows}
              free={free}
              highlight={seats}
              caption={t('offer.price.fuel', { fuel: fuelLabel, km })}
            />
            {!free && row && (
              <p className="font-semibold text-savings">
                {tp('offer.price.recover', seats, {
                  amount: formatRon(seats * row.priceBani),
                  fuel: formatRon(data.tripCostBani),
                })}
              </p>
            )}
          </>
        ) : (
          <p className="text-sm leading-5 text-text-muted">{t('offer.price.waiting')}</p>
        )}
        <p className="text-sm leading-5 text-text-muted">{t('offer.price.lock')}</p>
        <div className="flex min-h-12 items-center justify-between gap-3 border-t border-(color:--hair) pt-3">
          <label htmlFor="offer-free" className="flex flex-1 flex-col">
            <span className="type-label">{t('offer.free')}</span>
            <span className="text-sm leading-5 text-text-muted">{t('offer.free.hint')}</span>
          </label>
          <input
            id="offer-free"
            type="checkbox"
            role="switch"
            className="switch"
            checked={free}
            onChange={(e) => setFree(e.target.checked)}
          />
        </div>
      </section>

      <AutoAcceptSwitch id="offer-auto" checked={autoAccept} onChange={setAutoAccept} />

      <RepeatFields
        value={{ ...repeat, until }}
        onChange={(v) => {
          setRepeat(v);
          setErrors((x) => ({ ...x, repeat: undefined }));
        }}
        minUntil={day}
        maxUntil={maxUntil}
        count={seriesCount}
        firstWeekday={isoWeekday(day)}
        error={errors.repeat}
      />

      {expiredNote && <Notice tone="warning">{t('offer.err.expired')}</Notice>}
      {banner && <Notice tone="error">{banner}</Notice>}

      <p className="flex items-start gap-2 text-sm leading-5 text-text-muted">
        <Icon name="shield" small className="mt-0.5" />
        {t('offer.private')}
      </p>

      <LaunchButton
        label={repeat.on ? t('offer.cta.series') : t('offer.cta')}
        confirmed={repeat.on ? t('offer.done.series.title') : t('offer.done.title')}
        wordmark={t('launch.haide')}
        sending={repeat.on ? t('offer.publishing.series') : t('offer.publishing')}
        onLaunch={launch}
        onDone={() => {
          void navigate('/offer/done', {
            state: { rideId: created.current, series: createdSeries.current },
            replace: false,
          });
          triggerPushPrompt();
        }}
        onError={fail}
      />

      <PlacePickerSheet
        open={picker !== null}
        kind={picker ?? 'from'}
        onSelect={pick}
        onClose={() => setPicker(null)}
      />
    </form>
  );
}
