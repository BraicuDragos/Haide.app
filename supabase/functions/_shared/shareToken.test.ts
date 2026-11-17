import { describe, expect, it } from 'vitest';
import { SHARE_TOKEN_RE, hashShareToken, newShareToken } from './shareToken.ts';

describe('share tokens (ADR 0026)', () => {
  it('are 22 base64url characters and match the only accepted shape', () => {
    for (let i = 0; i < 200; i++) {
      const t = newShareToken();
      expect(t).toHaveLength(22);
      expect(SHARE_TOKEN_RE.test(t)).toBe(true);
    }
  });

  it('do not collide over 10 000 draws', () => {
    const seen = new Set<string>();
    for (let i = 0; i < 10_000; i++) seen.add(newShareToken());
    expect(seen.size).toBe(10_000);
  });

  it('hash to 32 bytes, deterministically, and differently per token', async () => {
    const a = await hashShareToken('AAAAAAAAAAAAAAAAAAAAAA');
    const a2 = await hashShareToken('AAAAAAAAAAAAAAAAAAAAAA');
    const b = await hashShareToken('AAAAAAAAAAAAAAAAAAAAAB');
    expect(a).toHaveLength(32);
    expect(Array.from(a)).toEqual(Array.from(a2));
    expect(Array.from(a)).not.toEqual(Array.from(b));
  });

  it('the pattern rejects anything else before it can reach the database', () => {
    const stem = 'A'.repeat(21);
    const bad = [
      '',
      'short',
      stem,
      `${stem}AA`,
      `${stem}+`,
      `${stem}/`,
      `${stem}=`,
      `${stem} `,
      '../'.repeat(8),
    ];
    for (const t of bad) expect(SHARE_TOKEN_RE.test(t), JSON.stringify(t)).toBe(false);
  });
});
