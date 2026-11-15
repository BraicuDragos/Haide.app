import { t } from '@/i18n';
import { readIntent } from '@/auth/intent';
import { stepsFor, type StepId } from '@/auth/onboarding';

const NAME: Record<
  StepId,
  'setup.step.account' | 'setup.step.agreement' | 'setup.step.profile' | 'setup.step.car'
> = {
  account: 'setup.step.account',
  agreement: 'setup.step.agreement',
  profile: 'setup.step.profile',
  car: 'setup.step.car',
};

/** "Step 2 of 3" plus the step name. 3 steps for passengers, 4 for drivers (ADR 0010). Never colour alone. */
export function StepProgress({ current }: { current: StepId }) {
  const steps = stepsFor(readIntent());
  const n = Math.max(1, steps.indexOf(current) + 1);
  return (
    <div className="flex flex-col gap-2">
      <p className="flex items-baseline justify-between gap-2 text-sm leading-5 font-semibold">
        <span>{t('setup.step', { n, total: steps.length })}</span>
        <span className="text-text-muted">{t(NAME[current])}</span>
      </p>
      <div aria-hidden="true" className="flex gap-1.5">
        {steps.map((s, i) => (
          <span
            key={s}
            className={`h-1.5 flex-1 rounded-full ${i < n ? 'bg-route' : 'bg-border'}`}
          />
        ))}
      </div>
    </div>
  );
}
