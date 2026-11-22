import type { PolicyDoc } from './types';

export type PolicyKind = 'terms' | 'privacy';

/** Lazy: the legal text never ships in the entry chunk. Locale suffix (`.en`) is the i18n hook. */
export const loadPolicy = async (kind: PolicyKind): Promise<PolicyDoc> =>
  kind === 'terms'
    ? (await import('./terms.v1_2.en')).terms
    : (await import('./privacy.v1_2.en')).privacy;

export type { PolicyDoc };
