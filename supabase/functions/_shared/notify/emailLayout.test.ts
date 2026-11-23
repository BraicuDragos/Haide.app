import { describe, expect, it } from 'vitest';
import { EMAIL_COLORS, escapeHtml } from './emailLayout.ts';

const lum = (hex: string): number => {
  const c = [1, 3, 5].map((i) => {
    const v = parseInt(hex.slice(i, i + 2), 16) / 255;
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * (c[0] ?? 0) + 0.7152 * (c[1] ?? 0) + 0.0722 * (c[2] ?? 0);
};
const ratio = (a: string, b: string): number => {
  const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
};

describe('email colours', () => {
  for (const mode of ['light', 'dark'] as const) {
    const c = EMAIL_COLORS[mode];
    it(`${mode}: text pairs reach 4.5:1`, () => {
      expect(ratio(c.text, c.card)).toBeGreaterThanOrEqual(4.5);
      expect(ratio(c.muted, c.card)).toBeGreaterThanOrEqual(4.5);
      expect(ratio(c.muted, c.page)).toBeGreaterThanOrEqual(4.5);
      expect(ratio(c.text, c.page)).toBeGreaterThanOrEqual(4.5);
      expect(ratio(c.onAction, c.action)).toBeGreaterThanOrEqual(4.5);
      expect(ratio(c.link, c.card)).toBeGreaterThanOrEqual(4.5);
    });
  }
  it('the wordmark colour is readable on the light page', () => {
    expect(ratio(EMAIL_COLORS.light.action, EMAIL_COLORS.light.page)).toBeGreaterThanOrEqual(4.5);
  });
});

describe('escapeHtml', () => {
  it('escapes the five special characters', () => {
    expect(escapeHtml(`<a href="x">&'`)).toBe('&lt;a href=&quot;x&quot;&gt;&amp;&#39;');
  });
});
