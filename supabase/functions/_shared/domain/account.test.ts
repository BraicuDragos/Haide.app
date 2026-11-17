import { describe, expect, it } from 'vitest';
import {
  isProfileComplete,
  memberSince,
  needsReaccept,
  ratingSummary,
  requiredConsents,
} from './account.ts';

const current = { terms: '1.0', privacy: '1.0' };
const accepted = [
  { kind: 'age_18' as const, version: null },
  { kind: 'terms' as const, version: '1.0' },
  { kind: 'privacy' as const, version: '1.0' },
];

describe('requiredConsents', () => {
  it('requires everything for a new user', () => {
    expect(requiredConsents(current, [])).toEqual(['age18', 'terms', 'privacy']);
  });

  it('is empty once all three are accepted at the current versions', () => {
    expect(requiredConsents(current, accepted)).toEqual([]);
  });

  it('asks again only for the document whose version was bumped', () => {
    expect(requiredConsents({ terms: '1.1', privacy: '1.0' }, accepted)).toEqual(['terms']);
    expect(requiredConsents({ terms: '1.0', privacy: '2.0' }, accepted)).toEqual(['privacy']);
  });

  it('accepting the new version clears it even when older rows exist', () => {
    expect(
      requiredConsents({ terms: '1.1', privacy: '1.0' }, [
        ...accepted,
        { kind: 'terms', version: '1.1' },
      ]),
    ).toEqual([]);
  });
});

describe('isProfileComplete', () => {
  const full = { firstName: 'Ioana', phoneE164: '+40721234567', photoPath: 'avatars/x.jpg' };
  it('needs first name, phone and photo', () => {
    expect(isProfileComplete(full)).toBe(true);
    expect(isProfileComplete({ ...full, firstName: null })).toBe(false);
    expect(isProfileComplete({ ...full, phoneE164: null })).toBe(false);
    expect(isProfileComplete({ ...full, photoPath: null })).toBe(false);
  });
});

describe('ratingSummary', () => {
  it('hides the rating below 3 ratings', () => {
    expect(ratingSummary(0, null)).toBeNull();
    expect(ratingSummary(2, 5)).toBeNull();
  });
  it('shows a one-decimal average from 3 ratings', () => {
    expect(ratingSummary(3, 4.666666)).toEqual({ average: 4.7, count: 3 });
    expect(ratingSummary(23, 4.8)).toEqual({ average: 4.8, count: 23 });
  });
});

describe('memberSince', () => {
  it('formats YYYY-MM in UTC', () => {
    expect(memberSince(new Date('2026-11-15T23:59:00Z'))).toBe('2026-11');
  });
});

describe('needsReaccept (E6)', () => {
  it('is false for a new user: first consent is not a re-acceptance', () => {
    expect(needsReaccept(current, [])).toBe(false);
  });

  it('is false when everything is accepted at the current versions', () => {
    expect(needsReaccept(current, accepted)).toBe(false);
  });

  it('is true when an older version of terms or privacy was accepted', () => {
    expect(needsReaccept({ terms: '1.1', privacy: '1.0' }, accepted)).toBe(true);
    expect(needsReaccept({ terms: '1.0', privacy: '1.1' }, accepted)).toBe(true);
    expect(needsReaccept({ terms: '1.1', privacy: '1.1' }, accepted)).toBe(true);
  });

  it('is false again once the new version was accepted too (history keeps the old rows)', () => {
    const history = [...accepted, { kind: 'terms' as const, version: '1.1' }];
    expect(needsReaccept({ terms: '1.1', privacy: '1.0' }, history)).toBe(false);
  });

  it('ignores age_18 and a user who only accepted one kind', () => {
    expect(
      needsReaccept({ terms: '1.1', privacy: '1.1' }, [{ kind: 'age_18', version: null }]),
    ).toBe(false);
  });
});
