import { useState } from 'react';
import { t, tp } from '@/i18n';
import { Button } from '@/ui/Button';
import { EmptyState } from '@/ui/EmptyState';
import { LaunchButton, type LaunchResult } from '@/ui/LaunchButton';
import { Loader } from '@/ui/Loader';
import { PageHeader } from '@/ui/PageHeader';
import { PriceRoll } from '@/ui/PriceRoll';
import { SeatPicker, SeatStrip } from '@/ui/SeatPicker';

// Dev and e2e harness for the reusable motion components (price reveal, seats, launch, loading, empty).
// The real screens that use them arrive with E2 (Offer), E3 (results, details) and E4 (booking).
export default function MotionDemoScreen() {
  const [seats, setSeats] = useState(2);
  const [price, setPrice] = useState('3.10');
  const [from, setFrom] = useState<string | undefined>();
  const [outcome, setOutcome] = useState<LaunchResult | 'fail'>('sent');
  const [done, setDone] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [round, setRound] = useState(0);

  return (
    <>
      <PageHeader title="Motion demo" />
      <div className="flex flex-col gap-8 p-4">
        <section aria-label="Price reveal" className="card flex flex-col gap-3 p-4">
          <p className="type-price text-price" data-testid="price">
            <PriceRoll key={round} value={price} from={from} label={`${price} RON`} animate />{' '}
            <span className="text-sm font-semibold text-text-muted">RON</span>
          </p>
          <Button
            variant="secondary"
            onClick={() => {
              setFrom(price);
              setPrice('1.90');
            }}
          >
            Drop the price
          </Button>
          <Button
            variant="tonal"
            onClick={() => {
              setFrom(undefined);
              setPrice('3.10');
              setRound((r) => r + 1);
            }}
          >
            Replay
          </Button>
        </section>

        <section aria-label="Seats" className="card flex flex-col gap-3 p-4">
          <SeatPicker
            max={4}
            value={seats}
            onChange={setSeats}
            legend={t('offer.seats')}
            seatLabel={(n) => tp('offer.seats.value', n)}
          />
          <p className="type-numeral-sm" aria-live="polite">
            {tp('offer.seats.value', seats)}
          </p>
          <SeatStrip total={3} taken={1} />
        </section>

        <section aria-label="Launch" className="flex flex-col gap-3">
          <fieldset className="m-0 flex gap-2 border-0 p-0">
            <legend className="type-label mb-1 p-0">Simulated result</legend>
            <div className="seg w-full">
              {(['sent', 'saved', 'fail'] as const).map((o) => (
                <label key={o}>
                  <input
                    type="radio"
                    name="outcome"
                    checked={outcome === o}
                    onChange={() => setOutcome(o)}
                  />
                  {o}
                </label>
              ))}
            </div>
          </fieldset>
          <LaunchButton
            key={`${outcome}-${round}`}
            label={t('request.send')}
            confirmed={t('request.sent.toast')}
            saved={t('request.saved')}
            wordmark={t('launch.haide')}
            sending={t('request.sending')}
            onLaunch={() =>
              outcome === 'fail'
                ? Promise.reject(new Error('simulated'))
                : Promise.resolve<LaunchResult>(outcome)
            }
            onDone={(r) => setDone(r)}
            onError={() => setError(t('error.generic'))}
          />
          {done && <p role="status">Done: {done}</p>}
          {error && <p role="alert">{error}</p>}
          <Button
            variant="ghost"
            onClick={() => {
              setDone(null);
              setError(null);
              setRound((r) => r + 1);
            }}
          >
            Reset
          </Button>
        </section>

        <section aria-label="Loading">
          <Loader label={t('results.loading')} />
        </section>
        <section aria-label="Empty">
          <EmptyState title={t('offer.soon.title')} body={t('offer.soon.body')} />
        </section>
      </div>
    </>
  );
}
