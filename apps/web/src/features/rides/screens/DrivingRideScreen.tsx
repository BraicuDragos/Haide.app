import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Link, useParams } from 'react-router';
import { ApiError } from '@/api/client';
import { keys } from '@/api/keys';
import { getMyRide, postRideCancel } from '@/api/rides';
import type { OwnerRide, RidePassengerItem } from '@/api/types';
import { useBack } from '@/app/useBack';
import { RequireAuth } from '@/auth/RequireAuth';
import { Call112Button } from '@/features/safety/Call112Button';
import { LazyBlockSheet, LazyNoShowSheet, LazyReportSheet } from '@/features/safety/sheets';
import { t, tError, tp } from '@/i18n';
import { dayLabel } from '@/lib/dates';
import { formatRon, formatTime } from '@/lib/format';
import { Button } from '@/ui/Button';
import { EmptyState } from '@/ui/EmptyState';
import { Loader } from '@/ui/Loader';
import { Notice } from '@/ui/Notice';
import { PageHeader } from '@/ui/PageHeader';
import { PriceRoll } from '@/ui/PriceRoll';
import { SeatStrip } from '@/ui/SeatPicker';
import { Sheet } from '@/ui/Sheet';
import { useToast } from '@/ui/Toast';
import { OwnerMap } from '../components/OwnerMap';
import { PassengerCard, type PassengerAction } from '../components/PassengerCard';
import { PriceTable } from '../components/PriceTable';
import { RequestCard } from '../components/RequestCard';
import { RideStops } from '../components/RideStops';
import { StatusPill } from '../components/StatusPill';

const BACK = '/rides?role=driving';
const bani = (n: number) => (n / 100).toFixed(2);

/** Driver ride (2.6): exact map, route, seats, what passengers pay, requests and passengers (E4), cancel (2.7). */
export default function DrivingRideScreen() {
  return (
    <RequireAuth title={t('driverRide.title')}>
      <Ride />
    </RequireAuth>
  );
}

function Ride() {
  const { id = '' } = useParams();
  const back = useBack(BACK);
  const q = useQuery({
    queryKey: keys.rides.mine(id),
    queryFn: ({ signal }) => getMyRide(id, signal),
    retry: (n, err) => !(err instanceof ApiError && err.status === 404) && n < 2,
  });

  if (q.isPending)
    return (
      <>
        <PageHeader title={t('driverRide.title')} onBack={back} />
        <div aria-busy="true">
          <Loader label={t('driverRide.loading')} />
        </div>
      </>
    );
  if (q.isError || !q.data) {
    const gone = q.error instanceof ApiError && q.error.status === 404;
    return (
      <>
        <PageHeader title={t('driverRide.title')} onBack={back} />
        {gone ? (
          <EmptyState title={t('errors.NOT_FOUND')} body="">
            <Link to={BACK} className="btn btn-primary">
              {t('rides.title')}
            </Link>
          </EmptyState>
        ) : (
          <div className="flex flex-col items-start gap-3 p-4">
            <Notice tone="error">
              {q.error instanceof ApiError && q.error.code !== 'NETWORK'
                ? tError(q.error.code)
                : t('rides.err')}
            </Notice>
            <Button variant="secondary" onClick={() => void q.refetch()}>
              {t('common.retry')}
            </Button>
          </div>
        )}
      </>
    );
  }
  return <RideDetail ride={q.data} back={back} />;
}

function RideDetail({ ride, back }: { ride: OwnerRide; back: () => void }) {
  const [cancelOpen, setCancelOpen] = useState(false);
  const [sheet, setSheet] = useState<{
    action: PassengerAction;
    passenger: RidePassengerItem;
  } | null>(null);
  const n = ride.seatsBooked;
  const open = ride.status === 'published';
  const row = ride.priceTable.find((r) => r.passengers === Math.max(n, 1));
  const fuel = formatRon(ride.tripCostBani);
  const km = (ride.distanceM / 1000).toFixed(1);
  const reportedBy = ride.passengers.find(
    (p) => p.status === 'no_show' && p.noShowBy === 'passenger',
  );
  const markedByYou = ride.passengers.find(
    (p) => p.status === 'no_show' && p.noShowBy === 'driver',
  );
  const rode = ride.passengers.some((p) => p.status === 'completed');
  const who = sheet?.passenger;
  const whoName = who?.passenger.firstName ?? '-';
  const close = () => setSheet(null);

  return (
    <>
      <PageHeader title={t('driverRide.title')} onBack={back} />
      <div className="flex flex-col gap-5 px-4 pt-4 pb-6">
        {ride.status === 'cancelled' && <Notice tone="info">{t('driverRide.cancelled')}</Notice>}

        {ride.status === 'completed' && (
          <Notice tone="success">
            {rode ? t('driverRide.completed') : t('driverRide.completed.none')}
          </Notice>
        )}
        {reportedBy && (
          <Notice tone="warning">
            {t('driverRide.noShow.byPassenger', { name: reportedBy.passenger.firstName ?? '-' })}
          </Notice>
        )}
        {markedByYou && !reportedBy && (
          <Notice tone="info">
            {t('driverRide.noShow.byYou', { name: markedByYou.passenger.firstName ?? '-' })}
          </Notice>
        )}

        <Call112Button window={ride.call112Window} />

        <div className="flex items-end justify-between gap-3">
          <div>
            <p className="type-numeral">{formatTime(ride.departureAt)}</p>
            <p className="text-text-muted">{dayLabel(ride.departureAt)}</p>
          </div>
          <StatusPill status={ride.status} />
        </div>

        <OwnerMap ride={ride} />

        <section className="card flex flex-col gap-3 p-4" aria-label={t('driverRide.title')}>
          <RideStops from={ride.origin.label} to={ride.destination.label} />
          <div className="flex flex-col items-start gap-2">
            <SeatStrip total={ride.seatsOffered} taken={n} />
            <p className="text-sm leading-5 text-text-muted">
              {t('rides.seatsTaken', { booked: n, total: ride.seatsOffered })}
              {' · '}
              {t('common.km', { n: km })}
            </p>
          </div>
          {ride.note && <p className="text-sm leading-5">{ride.note}</p>}
        </section>

        {open && (
          <section aria-labelledby="dr-req" className="flex flex-col gap-2">
            <h2 id="dr-req" className="type-h3">
              {t('driverRide.requests')}
            </h2>
            {ride.requests.length === 0 ? (
              <p className="text-text-muted">{t('driverRide.noRequests')}</p>
            ) : (
              <>
                <p className="text-text-muted">{tp('rides.requests', ride.requests.length)}</p>
                <ul className="m-0 flex list-none flex-col gap-3 p-0">
                  {ride.requests.map((r) => (
                    <RequestCard
                      key={r.bookingId}
                      rideId={ride.id}
                      request={r}
                      full={n >= ride.seatsOffered}
                      isFree={ride.isFree}
                    />
                  ))}
                </ul>
              </>
            )}
          </section>
        )}

        <section aria-labelledby="dr-price" className="card flex flex-col gap-3 p-4">
          <h2 id="dr-price" className="type-h3">
            {t('offer.price.title')}
          </h2>
          {ride.isFree ? (
            <p className="type-price">{t('common.free')}</p>
          ) : (
            row && (
              <>
                <p className="type-price text-price">
                  {n === 0 && (
                    <span className="type-body mr-2 text-text-muted">{t('card.upTo')}</span>
                  )}
                  <PriceRoll value={bani(row.priceBani)} label={formatRon(row.priceBani)} animate />{' '}
                  <span aria-hidden="true" className="type-body text-text-muted">
                    RON
                  </span>
                </p>
                {n === 0 ? (
                  <p className="text-sm leading-5 text-text-muted">
                    {t('driverRide.recover.none', { fuel })}
                  </p>
                ) : (
                  <>
                    <p className="text-sm leading-5">
                      {t('driverRide.priceNow', { price: formatRon(row.priceBani) })}
                    </p>
                    <p className="font-semibold text-savings">
                      {t('driverRide.recover', { amount: formatRon(n * row.priceBani), fuel })}
                    </p>
                  </>
                )}
              </>
            )
          )}
          <PriceTable
            rows={ride.priceTable}
            free={ride.isFree}
            caption={t('detail.priceTable.caption')}
          />
          <p className="text-sm leading-5 text-text-muted">{t('driverRide.fuelRule')}</p>
        </section>

        <section aria-labelledby="dr-pax" className="flex flex-col gap-2">
          <h2 id="dr-pax" className="type-h3">
            {t('driverRide.passengers')}
          </h2>
          {ride.passengers.length === 0 ? (
            <p className="text-text-muted">{t('driverRide.noPassengers')}</p>
          ) : (
            <>
              <ul className="m-0 flex list-none flex-col gap-3 p-0">
                {ride.passengers.map((p) => (
                  <PassengerCard
                    key={p.bookingId}
                    passenger={p}
                    onAction={(action, passenger) => setSheet({ action, passenger })}
                  />
                ))}
              </ul>
              <p className="text-sm leading-5 text-text-muted">{t('driverRide.pax.hiddenAfter')}</p>
            </>
          )}
        </section>

        {open && ride.canCancel && (
          <Button variant="danger" block onClick={() => setCancelOpen(true)}>
            {t('driverRide.cancel')}
          </Button>
        )}
      </div>

      <CancelSheet ride={ride} open={cancelOpen} onClose={() => setCancelOpen(false)} />
      {who && (
        <>
          <LazyNoShowSheet
            open={sheet?.action === 'noshow'}
            onClose={close}
            bookingId={who.bookingId}
            rideId={ride.id}
            as="driver"
            name={whoName}
          />
          <LazyReportSheet
            open={sheet?.action === 'report'}
            onClose={close}
            user={{ id: who.passenger.id, firstName: who.passenger.firstName }}
            bookingId={who.bookingId}
            rideId={ride.id}
          />
          <LazyBlockSheet
            open={sheet?.action === 'block'}
            onClose={close}
            user={{ id: who.passenger.id, firstName: who.passenger.firstName }}
            stayOnPage
          />
        </>
      )}
    </>
  );
}

/** Cancel ride (2.7): the consequence for passengers, the late-cancel warning, and a clear way to keep the ride. */
function CancelSheet({
  ride,
  open,
  onClose,
}: {
  ride: OwnerRide;
  open: boolean;
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const toast = useToast();
  const [error, setError] = useState<string | null>(null);
  const cancel = useMutation({
    mutationFn: () => postRideCancel(ride.id),
    onSuccess: (updated) => {
      qc.setQueryData(keys.rides.mine(ride.id), updated);
      void qc.invalidateQueries({ queryKey: keys.rides.all });
      toast.show(t('driverRide.cancel.toast'));
      onClose();
    },
    onError: (err) => {
      const code = err instanceof ApiError ? err.code : 'NETWORK';
      setError(tError(code));
      // The ride moved on without us (already cancelled, completed): show its real state behind the sheet.
      if (code === 'INVALID_STATE' || code === 'NOT_FOUND')
        void qc.invalidateQueries({ queryKey: keys.rides.mine(ride.id) });
    },
  });
  const n = ride.seatsBooked;

  return (
    <Sheet
      open={open}
      title={t('driverRide.cancel.title')}
      onClose={() => {
        if (!cancel.isPending) {
          setError(null);
          onClose();
        }
      }}
    >
      <p>{n === 0 ? t('driverRide.cancel.body.none') : tp('driverRide.cancel.body', n)}</p>
      {ride.lateCancelIfNow && <Notice tone="warning">{t('driverRide.cancel.late')}</Notice>}
      {error && <Notice tone="error">{error}</Notice>}
      <div className="mt-auto flex flex-col gap-3">
        <Button variant="danger" block loading={cancel.isPending} onClick={() => cancel.mutate()}>
          {t('driverRide.cancel.confirm')}
        </Button>
        <Button
          variant="secondary"
          block
          disabled={cancel.isPending}
          onClick={() => {
            setError(null);
            onClose();
          }}
        >
          {t('driverRide.cancel.keep')}
        </Button>
      </div>
    </Sheet>
  );
}
