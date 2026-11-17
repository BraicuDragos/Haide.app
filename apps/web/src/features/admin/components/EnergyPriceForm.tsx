import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useId, useState } from 'react';
import { postEnergyPrice, type EnergyFuel, type EnergyPricesResponse } from '@/api/admin';
import { ApiError } from '@/api/client';
import { keys } from '@/api/keys';
import { t, tError, type MessageKey } from '@/i18n';
import { bucharestToIso } from '@/lib/dates';
import { Button } from '@/ui/Button';
import { SelectField, TextArea, TextField } from '@/ui/Field';
import { Notice } from '@/ui/Notice';
import { useToast } from '@/ui/Toast';
import { CENTI, changePct, isLargeChange, MILLI, parseScaled } from '../energyChange';

// Hybrid keeps its own price row (ADR 0035) and the form hint tells the admin to update it: it must be selectable.
const FUELS: EnergyFuel[] = ['petrol', 'diesel', 'lpg', 'hybrid', 'electric'];
const FUEL_KEY = {
  petrol: 'vehicle.fuel.petrol',
  diesel: 'vehicle.fuel.diesel',
  lpg: 'vehicle.fuel.lpg',
  hybrid: 'vehicle.fuel.hybrid',
  electric: 'vehicle.fuel.electric',
} as const satisfies Record<EnergyFuel, MessageKey>;
export const fuelLabel = (f: EnergyFuel) => t(FUEL_KEY[f]);

const FIELD_ERRORS: Record<string, MessageKey> = {
  past: 'admin.energy.err.past',
  too_far: 'admin.energy.err.tooFar',
  not_after_latest: 'admin.energy.err.notAfterLatest',
};

/**
 * Adds a price version. The change % against the latest row of that fuel is shown live; over 30 % asks for an
 * explicit confirmation (the server enforces the same rule and answers LARGE_CHANGE).
 */
export function EnergyPriceForm({ data }: { data: EnergyPricesResponse }) {
  const id = useId();
  const qc = useQueryClient();
  const toast = useToast();
  const [fuel, setFuel] = useState<EnergyFuel>('petrol');
  const [price, setPrice] = useState('');
  const [consumption, setConsumption] = useState('');
  const [when, setWhen] = useState<'now' | 'later'>('now');
  const [at, setAt] = useState('');
  const [note, setNote] = useState('');
  const [override, setOverride] = useState(false);
  const [serverLarge, setServerLarge] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [fieldErr, setFieldErr] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);

  const row = data.fuels.find((f) => f.fuelType === fuel);
  const latest = row?.scheduled ?? row?.current ?? null;
  const unit = row?.unit ?? (fuel === 'electric' ? 'kWh' : 'l');

  const priceMilli = parseScaled(price, MILLI);
  const consCenti = parseScaled(consumption, CENTI);
  const pricePct = priceMilli !== null ? changePct(latest?.priceMilli, priceMilli) : null;
  const consPct = consCenti !== null ? changePct(latest?.consumptionCenti, consCenti) : null;
  const large =
    serverLarge ||
    (priceMilli !== null && isLargeChange(latest?.priceMilli, priceMilli)) ||
    (consCenti !== null && isLargeChange(latest?.consumptionCenti, consCenti));
  const worst = Math.max(Math.abs(pricePct ?? 0), Math.abs(consPct ?? 0));

  const save = useMutation({
    mutationFn: () =>
      postEnergyPrice({
        fuelType: fuel,
        priceMilli: priceMilli!,
        consumptionCenti: consCenti!,
        sourceNote: note.trim(),
        ...(when === 'later' && at
          ? { effectiveFrom: bucharestToIso(at.slice(0, 10), at.slice(11, 16)) }
          : {}),
        ...(override ? { overrideLargeChange: true } : {}),
      }),
    onSuccess: async () => {
      toast.show(t('admin.toast.energyAdded'));
      setPrice('');
      setConsumption('');
      setNote('');
      setOverride(false);
      setServerLarge(false);
      setSubmitted(false);
      setFieldErr({});
      await qc.invalidateQueries({ queryKey: keys.admin.energy });
    },
    onError: (err) => {
      const code = err instanceof ApiError ? err.code : undefined;
      if (code === 'LARGE_CHANGE') {
        setServerLarge(true);
        return;
      }
      if (err instanceof ApiError && err.fields) {
        setFieldErr(err.fields);
        if (code === 'VALIDATION_FAILED') return;
      }
      setError(tError(code));
    },
  });

  const bad = {
    price: submitted && (priceMilli === null || priceMilli < 100 || priceMilli > 50_000),
    cons: submitted && (consCenti === null || consCenti < 100 || consCenti > 5_000),
    note: submitted && (note.trim().length < 1 || note.trim().length > 200),
    at: submitted && when === 'later' && !at,
  };

  function submit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitted(true);
    setError(null);
    setFieldErr({});
    const invalid =
      priceMilli === null ||
      priceMilli < 100 ||
      priceMilli > 50_000 ||
      consCenti === null ||
      consCenti < 100 ||
      consCenti > 5_000 ||
      note.trim().length < 1 ||
      (when === 'later' && !at);
    if (invalid) return;
    if (large && !override) return;
    save.mutate();
  }

  const serverField = (k: string) => {
    const code = fieldErr[k];
    if (!code) return undefined;
    const key = FIELD_ERRORS[code];
    return key ? t(key) : t('errors.VALIDATION_FAILED');
  };

  return (
    <form onSubmit={submit} noValidate className="card flex flex-col gap-4 p-4">
      <h2 className="type-h3">{t('admin.energy.formTitle')}</h2>
      <SelectField
        id={`${id}-fuel`}
        label={t('admin.energy.fuel')}
        value={fuel}
        onChange={(e) => {
          setFuel(e.target.value as EnergyFuel);
          setOverride(false);
          setServerLarge(false);
        }}
      >
        {FUELS.map((f) => (
          <option key={f} value={f}>
            {fuelLabel(f)}
          </option>
        ))}
      </SelectField>
      {fuel === 'petrol' && (
        <p className="text-sm leading-5 text-text-muted">{t('admin.energy.hybridHint')}</p>
      )}

      <TextField
        id={`${id}-price`}
        label={t('admin.energy.price', { unit })}
        hint={t('admin.energy.priceHint')}
        inputMode="decimal"
        autoComplete="off"
        value={price}
        onChange={(e) => {
          setPrice(e.target.value);
          setServerLarge(false);
        }}
        error={bad.price ? t('admin.energy.priceErr') : (serverField('priceMilli') ?? undefined)}
      />
      <TextField
        id={`${id}-cons`}
        label={t('admin.energy.consumption', { unit })}
        hint={t('admin.energy.consumptionHint')}
        inputMode="decimal"
        autoComplete="off"
        value={consumption}
        onChange={(e) => {
          setConsumption(e.target.value);
          setServerLarge(false);
        }}
        error={
          bad.cons
            ? t('admin.energy.consumptionErr')
            : (serverField('consumptionCenti') ?? undefined)
        }
      />

      {latest && (
        <p className="text-sm leading-5 text-text-muted" aria-live="polite">
          {t('admin.energy.change', {
            price:
              pricePct === null ? t('admin.noValue') : `${pricePct > 0 ? '+' : ''}${pricePct} %`,
            consumption:
              consPct === null ? t('admin.noValue') : `${consPct > 0 ? '+' : ''}${consPct} %`,
          })}
        </p>
      )}

      {large && (
        <div className="flex flex-col gap-3">
          <Notice tone="warning">
            {t('admin.energy.largeChange', { pct: worst > 0 ? String(Math.round(worst)) : '30+' })}
          </Notice>
          <label className="flex min-h-12 items-start gap-3">
            <input
              type="checkbox"
              checked={override}
              onChange={(e) => setOverride(e.target.checked)}
              className="mt-1 size-6 flex-none accent-(--theme-action)"
              aria-describedby={submitted && !override ? `${id}-ov-err` : undefined}
            />
            <span className="font-semibold">{t('admin.energy.override')}</span>
          </label>
          {submitted && !override && (
            <p
              id={`${id}-ov-err`}
              role="alert"
              className="text-sm leading-5 font-semibold text-error"
            >
              {t('admin.energy.overrideRequired')}
            </p>
          )}
        </div>
      )}

      <fieldset className="flex flex-col gap-2">
        <legend className="type-label">{t('admin.energy.when')}</legend>
        <div className="seg">
          <label>
            <input
              type="radio"
              name={`${id}-when`}
              checked={when === 'now'}
              onChange={() => setWhen('now')}
            />
            {t('admin.energy.now')}
          </label>
          <label>
            <input
              type="radio"
              name={`${id}-when`}
              checked={when === 'later'}
              onChange={() => setWhen('later')}
            />
            {t('admin.energy.later')}
          </label>
        </div>
      </fieldset>
      {when === 'later' && (
        <TextField
          id={`${id}-at`}
          type="datetime-local"
          label={t('admin.energy.at')}
          hint={t('admin.energy.atHint')}
          value={at}
          onChange={(e) => setAt(e.target.value)}
          error={bad.at ? t('admin.energy.atErr') : serverField('effectiveFrom')}
        />
      )}
      {when === 'now' && serverField('effectiveFrom') && (
        <p role="alert" className="text-sm leading-5 font-semibold text-error">
          {serverField('effectiveFrom')}
        </p>
      )}

      <TextArea
        id={`${id}-note`}
        label={t('admin.energy.source')}
        hint={t('admin.energy.sourceHint')}
        maxLength={200}
        value={note}
        onChange={(e) => setNote(e.target.value)}
        error={bad.note ? t('admin.energy.sourceErr') : undefined}
      />

      {error && <Notice tone="error">{error}</Notice>}
      <Button type="submit" block loading={save.isPending}>
        {t('admin.energy.save')}
      </Button>
    </form>
  );
}
