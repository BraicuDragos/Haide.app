import { describe, expect, it } from 'vitest';
import { hashIp, newRequestId, safeEqual, sha256Hex } from './hash.ts';
import { scrubText } from './scrub.ts';

describe('hash helpers', () => {
  it('computes SHA-256', async () => {
    expect(await sha256Hex('abc')).toBe(
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
    );
  });

  it('rotates IP hashes daily and per salt, never containing the IP', async () => {
    const a = await hashIp('203.0.113.9', 'salt-one', '2026-11-16');
    expect(a).toHaveLength(32);
    expect(await hashIp('203.0.113.9', 'salt-one', '2026-11-16')).toBe(a);
    expect(await hashIp('203.0.113.9', 'salt-one', '2026-11-17')).not.toBe(a);
    expect(await hashIp('203.0.113.9', 'salt-two', '2026-11-16')).not.toBe(a);
  });

  it('compares secrets with constant-time semantics', () => {
    expect(safeEqual('secret', 'secret')).toBe(true);
    expect(safeEqual('secret', 'secreT')).toBe(false);
    expect(safeEqual('secret', 'secret2')).toBe(false);
    expect(safeEqual('', '')).toBe(true);
  });

  it('creates unique, sortable request ids', () => {
    const t = new Date('2026-11-16T05:00:00Z');
    const a = newRequestId(t);
    expect(a).toHaveLength(26);
    expect(newRequestId(t)).not.toBe(a);
    expect(newRequestId(new Date('2026-11-16T05:00:01Z')) > a).toBe(true);
  });
});

describe('scrubText', () => {
  it('removes tokens, emails, coordinates and phones, then truncates', () => {
    const out = scrubText(
      'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjMifQ.sig_nature mail a.b+c@x.ro at 45.79712,24.15211 call 0721 234 567',
      500,
    );
    expect(out).not.toMatch(/eyJ|a\.b\+c|45\.79712|0721/);
    expect(scrubText('x'.repeat(50), 10)).toHaveLength(10);
  });

  it('keeps ordinary diagnostic text', () => {
    expect(scrubText('TypeError: x is undefined at App.tsx:42', 500)).toBe(
      'TypeError: x is undefined at App.tsx:42',
    );
  });
});
