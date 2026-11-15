import { describe, expect, it } from 'vitest';
import { ERROR_CODES, ERROR_STATUS, errorEnvelopeSchema } from '../contracts/errors.ts';
import { DomainError } from './errors.ts';
import { fixedClock } from './clock.ts';
import * as rules from './rules.ts';

describe('DomainError', () => {
  it('carries a code and optional fields', () => {
    const e = new DomainError('VALIDATION_FAILED', 'bad', { seats: 'too_many' });
    expect(e).toBeInstanceOf(Error);
    expect(e.code).toBe('VALIDATION_FAILED');
    expect(e.fields).toEqual({ seats: 'too_many' });
    expect(new DomainError('RIDE_FULL').message).toBe('RIDE_FULL');
  });
});

describe('error contract', () => {
  it('maps every code to an HTTP status and validates the envelope', () => {
    for (const code of ERROR_CODES) {
      expect(ERROR_STATUS[code]).toBeGreaterThanOrEqual(400);
    }
    const ok = errorEnvelopeSchema.safeParse({
      error: { code: 'RIDE_FULL', message: 'x', requestId: 'r1' },
    });
    expect(ok.success).toBe(true);
    expect(
      errorEnvelopeSchema.safeParse({ error: { code: 'NOPE', message: 'x', requestId: 'r' } })
        .success,
    ).toBe(false);
  });
});

describe('rules and clock', () => {
  it('exposes the documented constants', () => {
    expect(rules.MAX_RIDES_PER_DAY).toBe(4);
    expect(rules.MIN_LEAD_MIN).toBe(15);
    expect(rules.PRICE_STEP_BANI).toBe(10);
  });

  it('fixedClock always returns the same instant (and a fresh Date)', () => {
    const c = fixedClock('2026-11-16T05:00:00Z');
    expect(c.now().getTime()).toBe(c.now().getTime());
    expect(c.now()).not.toBe(c.now());
  });
});
