/**
 * WCAG 2.x contrast check for the pairs the E-DM design actually uses.
 * Reads docs/brand/design-tokens.json (the only tokens file), composites translucent colours over a stated
 * backdrop, prints a Markdown table and exits 1 if any pair is below its threshold.
 *
 *   node docs/brand/tools/contrast.mjs            # table for both themes
 *   node docs/brand/tools/contrast.mjs --json     # machine-readable
 */
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const tokens = JSON.parse(readFileSync(resolve(here, '../design-tokens.json'), 'utf8'));

function parse(c) {
  c = c.trim();
  let m = /^#([0-9a-f]{6})$/i.exec(c);
  if (m) {
    const n = parseInt(m[1], 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255, 1];
  }
  m = /^rgba?\(([^)]+)\)$/i.exec(c);
  if (m) {
    const p = m[1].split(',').map((s) => parseFloat(s));
    return [p[0], p[1], p[2], p[3] ?? 1];
  }
  throw new Error(`cannot parse colour ${c}`);
}
/** Composite fg over an opaque backdrop. */
function over(fg, bg) {
  const [r, g, b, a] = parse(fg);
  const [br, bg_, bb] = parse(bg);
  return [r * a + br * (1 - a), g * a + bg_ * (1 - a), b * a + bb * (1 - a)];
}
const lin = (v) => {
  v /= 255;
  return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
};
const lum = ([r, g, b]) => 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
function ratio(fg, bg) {
  const back = parse(bg).slice(0, 3);
  const front = over(fg, bg);
  const [a, b] = [lum(front), lum(back)];
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}
const hex = (rgb) => '#' + rgb.map((v) => Math.round(v).toString(16).padStart(2, '0')).join('').toUpperCase();

const rows = [];
function check(theme, label, fgKey, bgKey, need, note = '') {
  const T = tokens.theme[theme];
  const fg = T[fgKey] ?? fgKey;
  let bg = T[bgKey] ?? bgKey;
  // A translucent background is resolved over a stated worst-case backdrop.
  const [, , , alpha] = parse(bg);
  let backdropNote = '';
  if (alpha < 1) {
    const backdrop = T[note] ?? note;
    bg = hex(over(bg, backdrop));
    backdropNote = ` (over ${backdrop})`;
  }
  const r = ratio(fg, bg);
  rows.push({ theme, label: label + backdropNote, fg, bg, ratio: r, need, pass: r >= need });
}

for (const theme of ['dark', 'light']) {
  const worst = theme === 'dark' ? tokens.theme.dark.route : tokens.theme.light.route;
  // --- text on the layers ---
  for (const bg of ['bg', 'surface', 'surface-subtle', 'bg-deep']) {
    check(theme, `Body text on ${bg}`, 'text', bg, 4.5);
    check(theme, `Muted text on ${bg}`, 'text-muted', bg, 4.5);
  }
  for (const bg of ['bg', 'surface', 'surface-subtle', 'bg-deep'])
    check(theme, `Subtle text and placeholder on ${bg}`, 'text-subtle', bg, 4.5);
  check(theme, 'Link on surface', 'link', 'surface', 4.5);
  check(theme, 'Link on bg', 'link', 'bg', 4.5);
  // --- price and savings (the key moments) ---
  check(theme, 'Price on bg', 'price', 'bg', 4.5);
  check(theme, 'Price on surface', 'price', 'surface', 4.5);
  check(theme, 'Price on map-bg (glass-free overlay)', 'price', 'map-bg', 4.5);
  check(theme, 'Savings on surface', 'savings', 'surface', 4.5);
  check(theme, 'Savings on bg', 'savings', 'bg', 4.5);
  // --- glass: text on the translucent sheet over the worst backdrop ---
  check(theme, 'Body text on glass', 'text', 'surface-glass', 4.5, worst);
  check(theme, 'Muted text on glass', 'text-muted', 'surface-glass', 4.5, worst);
  check(theme, 'Price on glass', 'price', 'surface-glass', 4.5, worst);
  check(theme, 'Body text on glass', 'text', 'surface-glass', 4.5, 'map-bg');
  // --- actions ---
  check(theme, 'Primary button label on action', 'on-action', 'action', 4.5);
  check(theme, 'Primary button label on action-hover', 'on-action', 'action-hover', 4.5);
  check(theme, 'Primary button label on action-pressed', 'on-action', 'action-pressed', 4.5);
  check(theme, 'Outline button label on surface', 'on-outline', 'surface', 4.5);
  check(theme, 'Outline button border on surface (UI)', 'outline', 'surface', 3);
  check(theme, 'Primary button fill vs bg (UI)', 'action', 'bg', 3);
  check(theme, 'Tonal label on tint', 'on-tint', 'tint', 4.5);
  check(theme, 'Label on accent', 'on-accent', 'accent', 4.5);
  check(theme, 'Focus ring vs bg (UI)', 'focus-ring', 'bg', 3);
  check(theme, 'Focus ring vs surface (UI)', 'focus-ring', 'surface', 3);
  check(theme, 'Input border vs surface (UI)', 'border-strong', 'surface', 3);
  // --- route and map (graphics need 3:1, labels 4.5:1) ---
  check(theme, 'Route line vs map-bg (UI)', 'route', 'map-bg', 3);
  check(theme, 'Route core vs map-bg (UI)', 'route-core', 'map-bg', 3);
  check(theme, 'Pulse vs map-bg (UI)', 'pulse', 'map-bg', theme === 'dark' ? 3 : 0);
  check(theme, 'Pulse ring vs map-bg (UI)', 'pulse-ring', 'map-bg', theme === 'dark' ? 0 : 3);
  check(theme, 'Pulse vs its ring (UI)', 'pulse', 'pulse-ring', theme === 'dark' ? 0 : 3, 'map-bg');
  check(theme, 'Map labels on map-bg', 'map-label', 'map-bg', 4.5);
  // --- semantic text ---
  for (const s of ['success', 'warning', 'error', 'info']) check(theme, `${s} text on ${s}-bg`, s, `${s}-bg`, 4.5);
}

if (process.argv.includes('--json')) {
  console.log(JSON.stringify(rows, null, 2));
} else {
  for (const theme of ['dark', 'light']) {
    console.log(`\n### ${theme} theme\n`);
    console.log('| Pair | Foreground | Background | Ratio | Needs | Result |');
    console.log('|---|---|---|---|---|---|');
    for (const r of rows.filter((x) => x.theme === theme))
      console.log(
        `| ${r.label} | ${r.fg} | ${r.bg} | ${r.ratio.toFixed(2)}:1 | ${r.need ? r.need + ':1' : 'info'} | ${r.pass ? 'Pass' : '**FAIL**'} |`,
      );
  }
}
const failed = rows.filter((r) => !r.pass);
if (failed.length) {
  console.error(`\n${failed.length} pair(s) below threshold`);
  process.exit(1);
}
