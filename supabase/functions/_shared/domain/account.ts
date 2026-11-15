import type { ConsentRequired } from '../contracts/account.ts';
import { MIN_RATINGS_TO_SHOW } from './rules.ts';

/** Pure account rules: consent state, profile completeness, public rating. No I/O. */

export type CurrentLegal = { terms: string; privacy: string };
export type AcceptedConsent = { kind: 'terms' | 'privacy' | 'age_18'; version: string | null };

/**
 * What the user still has to accept. age18 once ever; terms and privacy must have been accepted at
 * the CURRENT version (a version bump puts them back in the list).
 */
export function requiredConsents(
  current: CurrentLegal,
  accepted: readonly AcceptedConsent[],
): ConsentRequired[] {
  const required: ConsentRequired[] = [];
  if (!accepted.some((c) => c.kind === 'age_18')) required.push('age18');
  if (!accepted.some((c) => c.kind === 'terms' && c.version === current.terms)) {
    required.push('terms');
  }
  if (!accepted.some((c) => c.kind === 'privacy' && c.version === current.privacy)) {
    required.push('privacy');
  }
  return required;
}

/** data-model 4.1: first name AND phone AND photo. */
export function isProfileComplete(p: {
  firstName: string | null;
  phoneE164: string | null;
  photoPath: string | null;
}): boolean {
  return Boolean(p.firstName && p.phoneE164 && p.photoPath);
}

/** Average is shown only with at least 3 ratings, else null ("New"). One decimal. */
export function ratingSummary(
  count: number,
  average: number | null,
): { average: number; count: number } | null {
  if (count < MIN_RATINGS_TO_SHOW || average === null) return null;
  return { average: Math.round(average * 10) / 10, count };
}

/** `YYYY-MM` in UTC. */
export function memberSince(createdAt: Date): string {
  return createdAt.toISOString().slice(0, 7);
}
