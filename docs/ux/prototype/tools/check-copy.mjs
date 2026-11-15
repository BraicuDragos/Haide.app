/**
 * Keeps docs/ux/copy.md and the prototype strings in step, and enforces ADR 0020.
 *   node docs/ux/prototype/tools/check-copy.mjs
 * 1. every key in src/strings.js (STR) appears in copy.md as `key`, and every `key` in a copy.md table exists in STR
 * 2. the only STR value containing "!" is launch.haide, and it is exactly "Haide!"
 */
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
const here = dirname(fileURLToPath(import.meta.url));
const src = readFileSync(resolve(here, '../src/strings.js'), 'utf8');
const md = readFileSync(resolve(here, '../../copy.md'), 'utf8');
const STR = new Function(src.replace(/^const STR =/m, 'return') + '')();
const keys = Object.keys(STR);
const inMd = new Set([...md.matchAll(/^\| `([a-zA-Z0-9_.]+)` \|/gm)].map((m) => m[1]));
const problems = [];
for (const k of keys) if (!inMd.has(k)) problems.push(`not in copy.md: ${k}`);
for (const k of inMd) if (!(k in STR)) problems.push(`in copy.md but not in STR: ${k}`);
for (const [k, v] of Object.entries(STR)) if (v.includes('!') && k !== 'launch.haide') problems.push(`exclamation mark outside the sanctioned exception: ${k}`);
if (STR['launch.haide'] !== 'Haide!') problems.push('launch.haide must be exactly "Haide!"');
console.log(`${keys.length} strings, ${inMd.size} documented keys, ${problems.length} problems`);
problems.forEach((p) => console.log('  ' + p));
process.exitCode = problems.length ? 1 : 0;
