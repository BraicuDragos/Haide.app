import type { Me } from '@/api/types';
import type { Intent } from './intent';

export type StepId = 'account' | 'agreement' | 'profile' | 'car';

/** Steps for this intent: 3 for passengers, 4 for drivers (ia-and-flows F1). */
export function stepsFor(intent: Intent): StepId[] {
  return intent.kind === 'offer'
    ? ['account', 'agreement', 'profile', 'car']
    : ['account', 'agreement', 'profile'];
}

export const STEP_PATH: Record<Exclude<StepId, 'account'>, string> = {
  agreement: '/auth/consent',
  profile: '/setup/profile',
  car: '/setup/vehicle',
};

/** First step the user still has to do, or null when they may continue to the intent. */
export function nextStep(me: Me, intent: Intent): Exclude<StepId, 'account'> | null {
  if (!me.consent.upToDate) return 'agreement';
  if (!me.profileComplete) return 'profile';
  if (intent.kind === 'offer' && !me.hasVehicle) return 'car';
  return null;
}

/** Where to go after a step: the next missing step, else the place the user came from. */
export function destination(me: Me, intent: Intent): string {
  const next = nextStep(me, intent);
  return next ? STEP_PATH[next] : intent.returnTo;
}
