import { useQueryClient } from '@tanstack/react-query';
import { useRef, useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router';
import { putVehicle } from '@/api/account';
import { ApiError } from '@/api/client';
import { keys } from '@/api/keys';
import type { FuelType, Vehicle } from '@/api/types';
import { useAdvance } from '@/auth/hooks';
import { t, tError, type MessageKey } from '@/i18n';
import { isValidPlate, normalizePlate } from '@/lib/validation';
import { Button } from '@/ui/Button';
import { SelectField, TextField } from '@/ui/Field';
import { Notice } from '@/ui/Notice';
import { useToast } from '@/ui/Toast';

const FUELS: FuelType[] = ['petrol', 'diesel', 'lpg', 'hybrid', 'electric'];
const SEATS = [1, 2, 3, 4];
type Field = 'make' | 'model' | 'colour' | 'plate' | 'fuelType' | 'seats';
type Errors = Partial<Record<Field, string>>;
const ORDER: Field[] = ['make', 'model', 'colour', 'plate', 'fuelType', 'seats'];

/** Car form (screen 1.5): onboarding step 4 for drivers (`setup`) or Edit car (`edit`). One car per user. */
export function VehicleForm({
  vehicle,
  mode,
}: {
  vehicle: Vehicle | null;
  mode: 'setup' | 'edit';
}) {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const advance = useAdvance();
  const toast = useToast();

  const [v, setV] = useState({
    make: vehicle?.make ?? '',
    model: vehicle?.model ?? '',
    colour: vehicle?.colour ?? '',
    plate: vehicle?.plate ?? '',
    fuelType: (vehicle?.fuelType ?? '') as FuelType | '',
    seats: vehicle ? String(vehicle.seats) : '',
  });
  const [errors, setErrors] = useState<Errors>({});
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);
  const refs = {
    make: useRef<HTMLInputElement>(null),
    model: useRef<HTMLInputElement>(null),
    colour: useRef<HTMLInputElement>(null),
    plate: useRef<HTMLInputElement>(null),
    fuelType: useRef<HTMLSelectElement>(null),
    seats: useRef<HTMLSelectElement>(null),
  };
  const set = (k: keyof typeof v) => (e: { target: { value: string } }) => {
    setV((s) => ({ ...s, [k]: e.target.value }));
    setErrors((x) => ({ ...x, [k]: undefined }));
  };

  function focusFirst(errs: Errors) {
    const first = ORDER.find((k) => errs[k]);
    if (first) refs[first].current?.focus();
  }

  async function submit(ev: FormEvent) {
    ev.preventDefault();
    setError(undefined);
    const req = t('vehicle.err.required');
    const next: Errors = {};
    if (!v.make.trim()) next.make = req;
    if (!v.model.trim()) next.model = req;
    if (!v.colour.trim()) next.colour = req;
    if (!isValidPlate(v.plate)) next.plate = t('vehicle.err.plate');
    if (!v.fuelType) next.fuelType = req;
    if (!v.seats) next.seats = req;
    setErrors(next);
    if (Object.keys(next).length) return focusFirst(next);

    setBusy(true);
    try {
      const saved = await putVehicle({
        make: v.make.trim(),
        model: v.model.trim(),
        colour: v.colour.trim(),
        plate: normalizePlate(v.plate),
        fuelType: v.fuelType as FuelType,
        seats: Number(v.seats),
      });
      qc.setQueryData(keys.vehicle, saved);
      await qc.invalidateQueries({ queryKey: keys.me });
      if (mode === 'setup') await advance();
      else {
        toast.show(t('vehicle.saved'));
        void navigate('/profile', { replace: true });
      }
    } catch (err) {
      setBusy(false);
      const fields = err instanceof ApiError ? err.fields : undefined;
      const server: Errors = {};
      for (const k of ORDER)
        if (fields?.[k]) server[k] = k === 'plate' ? t('vehicle.err.plate') : req;
      if (Object.keys(server).length) {
        setErrors(server);
        focusFirst(server);
      } else setError(tError(err instanceof ApiError ? err.code : undefined));
    }
  }

  return (
    <form onSubmit={(e) => void submit(e)} noValidate className="flex flex-col gap-5">
      <TextField
        id="car-make"
        ref={refs.make}
        label={t('vehicle.make')}
        error={errors.make}
        autoComplete="off"
        required
        value={v.make}
        onChange={set('make')}
      />
      <TextField
        id="car-model"
        ref={refs.model}
        label={t('vehicle.model')}
        error={errors.model}
        autoComplete="off"
        required
        value={v.model}
        onChange={set('model')}
      />
      <TextField
        id="car-colour"
        ref={refs.colour}
        label={t('vehicle.colour')}
        error={errors.colour}
        autoComplete="off"
        required
        value={v.colour}
        onChange={set('colour')}
      />
      <TextField
        id="car-plate"
        ref={refs.plate}
        label={t('vehicle.plate')}
        hint={t('vehicle.plate.hint')}
        error={errors.plate}
        autoComplete="off"
        autoCapitalize="characters"
        spellCheck={false}
        required
        value={v.plate}
        onChange={set('plate')}
      />
      <SelectField
        id="car-fuel"
        ref={refs.fuelType}
        label={t('vehicle.fuel')}
        error={errors.fuelType}
        required
        value={v.fuelType}
        onChange={set('fuelType')}
      >
        <option value="">{t('common.choose')}</option>
        {FUELS.map((f) => (
          <option key={f} value={f}>
            {t(`vehicle.fuel.${f}` as MessageKey)}
          </option>
        ))}
      </SelectField>
      <SelectField
        id="car-seats"
        ref={refs.seats}
        label={t('vehicle.seats')}
        hint={t('vehicle.seats.hint')}
        error={errors.seats}
        required
        value={v.seats}
        onChange={set('seats')}
      >
        <option value="">{t('common.choose')}</option>
        {SEATS.map((n) => (
          <option key={n} value={n}>
            {n}
          </option>
        ))}
      </SelectField>
      <p className="text-sm leading-5 text-text-muted">{t('vehicle.note')}</p>
      {error && <Notice tone="error">{error}</Notice>}
      <Button type="submit" block loading={busy}>
        {t('vehicle.save')}
      </Button>
    </form>
  );
}
