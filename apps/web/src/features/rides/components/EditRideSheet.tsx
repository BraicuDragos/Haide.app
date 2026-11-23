import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useMemo, useRef, useState } from 'react';
import { getVehicle } from '@/api/account';
import { keys } from '@/api/keys';
import { patchRide } from '@/api/rides';
import type { EditRideRequest, OwnerRide } from '@/api/types';
import { AutoAcceptSwitch } from '@/features/offer/components/AutoAcceptSwitch';
import { t, tp } from '@/i18n';
import { bucharestParts, bucharestToIso, dateLabel, dayOptions } from '@/lib/dates';
import { minTimeFor } from '@/lib/timeSlots';
import { Button } from '@/ui/Button';
import { SelectField, TextArea } from '@/ui/Field';
import { Icon } from '@/ui/Icon';
import { Notice } from '@/ui/Notice';
import { SeatPicker } from '@/ui/SeatPicker';
import { Sheet } from '@/ui/Sheet';
import { TimePicker } from '@/ui/TimePicker';
import { useToast } from '@/ui/Toast';
import { classifyEditError, type EditField } from '../editErrors';

const MIN_LEAD_MS = 15 * 60_000;
const MAX_LEAD_MS = 14 * 24 * 3_600_000;
const NOTE_MAX = 200;
/** Used while the vehicle is unknown: the platform maximum. */
const DEFAULT_MAX_SEATS = 4;

type Errors = Partial<Record<EditField, string>>;

/** Passengers who hold a seat or a pending request: the people a new departure time is sent to. */
export const passengersToTell = (ride: OwnerRide) =>
  ride.requests.length + ride.passengers.filter((p) => p.status === 'confirmed').length;

/**
 * Edit ride (ADR 0041): time, seats, note and auto-accept. The route, price and car are fixed, and the sheet says so.
 * Only changed fields are sent. A new time tells every passenger with a seat or a pending request, so the sheet says
 * how many before the driver saves. The form is mounted only while the sheet is open, so it always starts from the
 * ride as it is now.
 */
export function EditRideSheet({
  ride,
  open,
  onClose,
}: {
  ride: OwnerRide;
  open: boolean;
  onClose: () => void;
}) {
  return (
    <Sheet open={open} title={t('editRide.title')} onClose={onClose}>
      {open && <EditForm ride={ride} onClose={onClose} />}
    </Sheet>
  );
}

function EditForm({ ride, onClose }: { ride: OwnerRide; onClose: () => void }) {
  const qc = useQueryClient();
  const toast = useToast();
  const start = useMemo(() => bucharestParts(ride.departureAt), [ride.departureAt]);
  const days = useMemo(() => {
    const list = dayOptions(15);
    return list.some((d) => d.value === start.day)
      ? list
      : [{ value: start.day, label: dateLabel(start.day) }, ...list];
  }, [start.day]);
  const vehicle = useQuery({ queryKey: keys.vehicle, queryFn: ({ signal }) => getVehicle(signal) });

  const [day, setDay] = useState(start.day);
  const [time, setTime] = useState(start.time);
  const [seats, setSeats] = useState(ride.seatsOffered);
  const [note, setNote] = useState(ride.note ?? '');
  const [auto, setAuto] = useState(ride.autoAccept);
  const [errors, setErrors] = useState<Errors>({});
  const [banner, setBanner] = useState<string | null>(null);

  const dayRef = useRef<HTMLSelectElement>(null);
  const timeRef = useRef<HTMLButtonElement>(null);
  const seatsRef = useRef<HTMLDivElement>(null);
  const noteRef = useRef<HTMLTextAreaElement>(null);

  const booked = ride.seatsBooked;
  const maxSeats = Math.max(vehicle.data?.seats ?? DEFAULT_MAX_SEATS, ride.seatsOffered);
  const timeChanged = day !== start.day || time !== start.time;
  const trimmed = note.trim();
  const noteChanged = trimmed !== (ride.note ?? '').trim();
  const changed =
    timeChanged || seats !== ride.seatsOffered || noteChanged || auto !== ride.autoAccept;
  const toTell = timeChanged ? passengersToTell(ride) : 0;

  const focus = (field: EditField | undefined) => {
    if (field === 'day') dayRef.current?.focus();
    else if (field === 'time') timeRef.current?.focus();
    else if (field === 'seats')
      (
        seatsRef.current?.querySelector<HTMLInputElement>('input:checked') ??
        seatsRef.current?.querySelector<HTMLInputElement>('input:not(:disabled)')
      )?.focus();
    else if (field === 'note') noteRef.current?.focus();
  };

  const save = useMutation({
    mutationFn: (body: EditRideRequest) => patchRide(ride.id, body),
    onSuccess: (updated, body) => {
      qc.setQueryData(keys.rides.mine(ride.id), updated);
      void qc.invalidateQueries({ queryKey: keys.rides.all });
      toast.show(body.departureAt && toTell > 0 ? t('editRide.toast.told') : t('editRide.toast'));
      onClose();
    },
    onError: (err) => {
      const f = classifyEditError(err, { maxSeats });
      if (f.field) setErrors({ [f.field]: f.message });
      else setBanner(f.message);
      focus(f.field);
      if (f.refetch) void qc.invalidateQueries({ queryKey: keys.rides.mine(ride.id) });
    },
  });

  function submit() {
    if (!changed || save.isPending) return;
    setBanner(null);
    const body: EditRideRequest = {};
    if (timeChanged) {
      const iso = bucharestToIso(day, time);
      const lead = new Date(iso).getTime() - Date.now();
      const message =
        lead < MIN_LEAD_MS
          ? t('offer.err.time')
          : lead > MAX_LEAD_MS
            ? t('errors.DEPARTURE_TOO_FAR')
            : null;
      if (message) {
        setErrors({ time: message });
        timeRef.current?.focus();
        return;
      }
      body.departureAt = iso;
    }
    if (seats !== ride.seatsOffered) body.seats = seats;
    if (noteChanged) body.note = trimmed === '' ? null : trimmed;
    if (auto !== ride.autoAccept) body.autoAccept = auto;
    setErrors({});
    save.mutate(body);
  }

  const clear = (field: EditField) => setErrors((e) => ({ ...e, [field]: undefined }));

  return (
    <form
      noValidate
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
      className="flex flex-1 flex-col gap-4"
    >
      <p className="flex items-start gap-2 text-sm leading-5 text-text-muted">
        <Icon name="info" small className="mt-0.5" />
        {t('editRide.route')}
      </p>

      <div className="grid grid-cols-2 gap-3">
        <SelectField
          id="edit-day"
          ref={dayRef}
          label={t('offer.day')}
          value={day}
          error={errors.day}
          onChange={(e) => {
            setDay(e.target.value);
            clear('day');
            clear('time');
          }}
        >
          {days.map((d) => (
            <option key={d.value} value={d.value}>
              {d.label}
            </option>
          ))}
        </SelectField>
        <TimePicker
          id="edit-time"
          ref={timeRef}
          label={t('offer.time')}
          value={time}
          minTime={() => minTimeFor(day, MIN_LEAD_MS)}
          error={errors.time}
          onChange={(v) => {
            setTime(v);
            clear('time');
          }}
        />
      </div>

      <div ref={seatsRef} className="flex flex-col gap-2">
        <SeatPicker
          max={maxSeats}
          min={Math.max(1, booked)}
          value={seats}
          legend={t('offer.seats')}
          hint={
            booked > 0
              ? tp('editRide.seats.booked', booked)
              : t('offer.seats.hint', { n: maxSeats })
          }
          seatLabel={(n) => tp('offer.seats.value', n)}
          onChange={(n) => {
            setSeats(n);
            clear('seats');
          }}
        />
        {errors.seats && (
          <p role="alert" className="flex items-start gap-1.5 text-sm font-semibold text-error">
            <Icon name="alert" small className="mt-0.5" />
            {errors.seats}
          </p>
        )}
      </div>

      <TextArea
        id="edit-note"
        ref={noteRef}
        label={t('offer.note')}
        optional
        rows={2}
        maxLength={NOTE_MAX}
        placeholder={t('offer.note.placeholder')}
        hint={t('offer.note.hint', { n: note.length })}
        error={errors.note}
        value={note}
        onChange={(e) => {
          setNote(e.target.value);
          clear('note');
        }}
      />

      <AutoAcceptSwitch id="edit-auto" checked={auto} onChange={setAuto} />

      {toTell > 0 && <Notice tone="info">{tp('editRide.notify', toTell)}</Notice>}
      {banner && <Notice tone="error">{banner}</Notice>}

      <div className="mt-auto flex flex-col gap-3">
        <Button type="submit" block loading={save.isPending} disabled={!changed}>
          {t('editRide.save')}
        </Button>
        <Button variant="secondary" block disabled={save.isPending} onClick={onClose}>
          {t('editRide.discard')}
        </Button>
      </div>
    </form>
  );
}
