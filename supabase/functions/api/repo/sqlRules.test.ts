import { readdirSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

/**
 * postgres.js infers the parameter type from the server. `${JSON.stringify(x)}::jsonb` is therefore
 * typed jsonb and the string is encoded a second time (a JSON string scalar, not an object), which
 * broke `POST /rides` (vehicle_snapshot check). The safe form is `::text::jsonb`.
 */
describe('repo SQL rules', () => {
  const dir = new URL('./', import.meta.url);
  const files = readdirSync(dir).filter((f) => f.endsWith('.ts') && !f.endsWith('.test.ts'));

  it.each(files)('%s never casts a JSON.stringify parameter straight to jsonb', (file) => {
    const src = readFileSync(new URL(file, dir), 'utf8');
    expect(src).not.toMatch(/JSON\.stringify\([^`]*\)\}\s*::jsonb/);
  });
});
