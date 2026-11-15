/* @vitest-environment node */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * Design rule (ADR 0016, brand guide): colours, easings and shadows come from the generated tokens only. A grep-based
 * guard so a hard-coded value cannot slip into the UI unnoticed.
 */
const SRC = fileURLToPath(new URL('..', import.meta.url));

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    return statSync(p).isDirectory() ? walk(p) : [p];
  });
}

// Files that may contain raw values, each with the reason.
const ALLOW = new Set([
  'styles/tokens.css', // generated from design-tokens.json
  'features/auth/screens/SignInScreen.tsx', // Google's mark keeps its own brand colours (third-party logo)
  'lib/image.ts', // canvas fill behind transparent PNGs before JPEG encoding (not UI)
]);

const files = walk(SRC)
  .filter((f) => /\.(ts|tsx|css)$/.test(f) && !/\.test\.tsx?$/.test(f))
  .map((f) => ({ f, rel: relative(SRC, f).split(sep).join('/') }))
  .filter(({ rel }) => !ALLOW.has(rel));

const HEX = /#[0-9a-fA-F]{3,8}\b/;
const FUNC = /\b(rgba?|hsla?|oklch|oklab|lab|lch|hwb)\(/;
const BEZIER = /cubic-bezier\(|linear\(\s*\d/;

describe('tokens only', () => {
  it('scans the source tree', () => {
    expect(files.length).toBeGreaterThan(30);
  });
  it.each(files)('$rel has no hard-coded colours or easing curves', ({ f }) => {
    // Strip comments: documentation may mention values.
    const code = readFileSync(f, 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/^\s*\/\/.*$/gm, '');
    expect(code).not.toMatch(HEX);
    expect(code).not.toMatch(FUNC);
    expect(code).not.toMatch(BEZIER);
  });
  it('no source references the retired Bricolage face', () => {
    const all = files.map(({ f }) => readFileSync(f, 'utf8')).join('\n');
    expect(all).not.toMatch(/Bricolage/i);
  });
});
