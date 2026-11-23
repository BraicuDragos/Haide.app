import { describe, expect, it } from 'vitest';
import { preheaderOf } from './templates.ts';

describe('preheaderOf', () => {
  it('keeps a short body as it is, whitespace collapsed', () => {
    expect(preheaderOf('Open Haide\n to decide.')).toBe('Open Haide to decide.');
  });

  it('cuts a long body at a word boundary, never mid-word', () => {
    const body =
      'Ana asked for a seat from Cisnădie to Piața Mare. Answer by 07:45 or the request expires. Open Haide to decide.';
    const out = preheaderOf(body);
    expect(out.endsWith('…')).toBe(true);
    expect(out.length).toBeLessThanOrEqual(111);
    expect(body.startsWith(out.slice(0, -1))).toBe(true);
    // the character after the cut in the body is a space: the last word is whole
    expect(body[out.length - 1]).toBe(' ');
  });
});
