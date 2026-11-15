/**
 * Generates apps/web/src/styles/tokens.css from docs/brand/design-tokens.json
 * (the single source of truth for colour, type, space, radius, shadow, motion).
 *
 * Run: pnpm --filter @haide/web tokens   (also runs before `build`)
 *
 * Output:
 *   :root              raw values as --tk-* custom properties + dark role tokens (--theme-*), the default
 *   [data-theme=light] light role tokens
 *   @theme inline    Tailwind v4 theme wired to the --tk-* / --theme-* variables
 *   @utility type-*  typography scale from font.scale
 *
 * Node 24 strips types natively: `node --experimental-strip-types scripts/tokens.ts`.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const src = resolve(here, '../../../docs/brand/design-tokens.json');
const out = resolve(here, '../src/styles/tokens.css');

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Json = Record<string, any>;
const t: Json = JSON.parse(readFileSync(src, 'utf8'));

const lines: string[] = [];
const root: string[] = [];
const theme: string[] = [];
const utilities: string[] = [];
const springs: string[] = []; // linear() easings, applied only where supported (see below)

// ---- raw palette ----
for (const [family, value] of Object.entries(
  t.color as Record<string, string | Record<string, string>>,
)) {
  if (typeof value === 'string') {
    root.push(`--tk-color-${family}: ${value.toLowerCase()};`);
    theme.push(`--color-${family}: var(--tk-color-${family});`);
  } else {
    for (const [step, hex] of Object.entries<string>(value)) {
      root.push(`--tk-color-${family}-${step}: ${hex.toLowerCase()};`);
      theme.push(`--color-${family}-${step}: var(--tk-color-${family}-${step});`);
    }
  }
}

// ---- role tokens (light on :root, dark opt-in) ----
const roles = Object.keys(t.theme.light);
const roleBlock = (name: 'light' | 'dark') =>
  roles.map((r) => `--theme-${r}: ${String(t.theme[name][r]).toLowerCase()};`);
for (const r of roles) theme.push(`--color-${r}: var(--theme-${r});`);

// ---- type ----
root.push(`--tk-font-base:
    ${t.font.family.base};`);
root.push(`--tk-font-heading:
    ${t.font.family.heading};`);
theme.push(`--font-sans: var(--tk-font-base);`);
theme.push(`--font-heading: var(--tk-font-heading);`);
for (const [k, v] of Object.entries<string>(t.font.size)) {
  root.push(`--tk-text-${k}: ${v};`);
  theme.push(`--text-${k}: var(--tk-text-${k});`);
}
for (const [k, v] of Object.entries<number>(t.font.lineHeight)) {
  root.push(`--tk-leading-${k}: ${v};`);
  theme.push(`--leading-${k}: var(--tk-leading-${k});`);
}
for (const [k, v] of Object.entries<number>(t.font.weight)) {
  root.push(`--tk-weight-${k}: ${v};`);
  theme.push(`--font-weight-${k}: var(--tk-weight-${k});`);
}

// ---- space (Tailwind multiplies --spacing, so 1 unit = space.1) ----
for (const [k, v] of Object.entries<string>(t.space)) root.push(`--tk-space-${k}: ${v};`);
theme.push(`--spacing: var(--tk-space-1);`);

// ---- radius, shadow, motion, breakpoints, sizing ----
for (const [k, v] of Object.entries<string>(t.radius)) {
  root.push(`--tk-radius-${k}: ${v};`);
  theme.push(`--radius-${k}: var(--tk-radius-${k});`);
}
for (const [k, v] of Object.entries<string>(t.shadow)) {
  root.push(`--tk-shadow-${k}: ${v.replace(/,(?=\S)/g, ', ')};`);
  theme.push(`--shadow-${k}: var(--tk-shadow-${k});`);
}
for (const [k, v] of Object.entries<string>(t.motion.duration)) root.push(`--tk-dur-${k}: ${v};`);
for (const [k, v] of Object.entries<string>(t.motion.easing)) {
  // A linear() spring ships with a "<name>-fallback" cubic-bezier for browsers without linear().
  const fallback = t.motion.easing[`${k}-fallback`];
  if (v.startsWith('linear(') && fallback) {
    root.push(`--tk-ease-${k}: ${fallback};`);
    springs.push(`--tk-ease-${k}: ${v};`);
  } else {
    root.push(`--tk-ease-${k}: ${v};`);
  }
  theme.push(`--ease-${k}: var(--tk-ease-${k});`);
}
// E-DM extras: flat groups emitted as --tk-<prefix>-<key> (depth, travel distances, stagger, press scales).
const extras: Array<[string, Record<string, string> | undefined]> = [
  ['blur', t.depth?.blur],
  ['grain', t.depth?.grain],
  ['travel', t.motion.distance],
  ['stagger', t.motion.stagger],
  ['scale', t.motion.scale],
];
for (const [prefix, group] of extras)
  for (const [k, v] of Object.entries(group ?? {})) root.push(`--tk-${prefix}-${k}: ${v};`);
for (const [k, v] of Object.entries<string>(t.breakpoint)) theme.push(`--breakpoint-${k}: ${v};`);
for (const [k, v] of Object.entries<string>(t.sizing)) root.push(`--tk-size-${k}: ${v};`);

// ---- typography scale as utilities (type-h1, type-body, ...) ----
const kebab = (s: string) => s.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`);
for (const [name, s] of Object.entries<Json>(t.font.scale)) {
  const decl = [
    `font-family: var(--tk-font-${s.family});`,
    `font-size: ${s.size};`,
    `line-height: ${s.lineHeight};`,
    `font-weight: ${s.weight};`,
    `letter-spacing: ${s.letterSpacing};`,
  ];
  if (s.fontFeature === 'tnum') decl.push('font-variant-numeric: tabular-nums;');
  utilities.push(`@utility type-${kebab(name)} {\n  ${decl.join('\n  ')}\n}`);
}

lines.push(
  '/* GENERATED by scripts/tokens.ts from docs/brand/design-tokens.json. Do not edit by hand. */',
  '',
  ':root {',
  ...root.map((l) => `  ${l}`),
  '  /* dark theme roles: the default (ADR 0016) */',
  ...roleBlock('dark').map((l) => `  ${l}`),
  '  color-scheme: dark;',
  '}',
  '',
  ":root[data-theme='light'] {",
  ...roleBlock('light').map((l) => `  ${l}`),
  '  color-scheme: light;',
  '}',
  '',
  ...(springs.length
    ? [
        '@supports (transition-timing-function: linear(0, 1)) {',
        '  :root {',
        ...springs.map((l) => `    ${l}`),
        '  }',
        '}',
        '',
      ]
    : []),
  '@theme inline {',
  '  --color-*: initial;',
  '  --text-*: initial;',
  '  --radius-*: initial;',
  '  --shadow-*: initial;',
  '  --breakpoint-*: initial;',
  ...theme.map((l) => `  ${l}`),
  '}',
  '',
  ...utilities.flatMap((u) => [u, '']),
);

writeFileSync(out, lines.join('\n'));
console.log(`tokens: wrote ${out}`);
