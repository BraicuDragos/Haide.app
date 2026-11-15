/**
 * Builds docs/ux/prototype/index.html (one self-contained file) from:
 *   src/shell.html   page shell, demo panel, night-map base
 *   src/styles.css   component CSS (reads token custom properties only)
 *   src/strings.js   STR: every UI string (same keys as docs/ux/copy.md)
 *   src/motion.js    motion helpers (WAAPI, View Transitions, rolling digits, travelling light)
 *   src/app.js       data, router, screens
 * and docs/brand/design-tokens.json (colours, durations, easings, shadows, depth) plus the fonts in apps/web/public/fonts.
 *
 *   node docs/ux/prototype/tools/build-prototype.mjs
 *
 * Token custom properties are generated the same way as docs/brand/tools/build-preview-motion.mjs and
 * apps/web/scripts/tokens.ts: --c-<role> per theme, --tk-dur-*, --tk-ease-*, --tk-travel-*, --tk-stagger-*, --tk-scale-*,
 * --tk-radius-*, --tk-size-*, --tk-blur-*, --tk-grain-*, --tk-shadow-*.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const proto = resolve(here, '..');
const root = resolve(proto, '../../..');
const tokens = JSON.parse(readFileSync(resolve(root, 'docs/brand/design-tokens.json'), 'utf8'));
const read = (p) => readFileSync(resolve(proto, p), 'utf8');
const b64 = (f) => readFileSync(resolve(root, 'apps/web/public/fonts', f)).toString('base64');
const datauri = (p) => 'data:image/svg+xml;base64,' + readFileSync(resolve(root, p)).toString('base64');

// ---------- tokens -> CSS ----------
const css = [];
const rootVars = [];
const kv = (prefix, obj) => Object.entries(obj ?? {}).forEach(([k, v]) => rootVars.push(`--tk-${prefix}-${k}: ${v};`));
kv('dur', tokens.motion.duration);
kv('travel', tokens.motion.distance);
kv('stagger', tokens.motion.stagger);
kv('scale', tokens.motion.scale);
kv('radius', tokens.radius);
kv('size', tokens.sizing);
kv('blur', tokens.depth.blur);
kv('grain', tokens.depth.grain);
kv('shadow', tokens.shadow);
const springs = [];
for (const [k, v] of Object.entries(tokens.motion.easing)) {
  const fb = tokens.motion.easing[`${k}-fallback`];
  if (v.startsWith('linear(') && fb) {
    rootVars.push(`--tk-ease-${k}: ${fb};`);
    springs.push(`--tk-ease-${k}: ${v};`);
  } else rootVars.push(`--tk-ease-${k}: ${v};`);
}
css.push(`:root{${rootVars.join('')}}`);
css.push(`@supports (transition-timing-function: linear(0, 1)){:root{${springs.join('')}}}`);
for (const theme of ['dark', 'light']) {
  const vars = Object.entries(tokens.theme[theme]).map(([k, v]) => `--c-${k}:${v};`).join('');
  css.push(theme === 'dark' ? `:root,:root[data-theme=dark]{${vars}}` : `:root[data-theme=light]{${vars}}`);
}
css.push(`:root{--f-head:${tokens.font.family.heading};--f-base:${tokens.font.family.base};}`);

// ---------- fonts (base64, latin and latin-ext so ș ț ă â î render) ----------
const RANGE_EXT =
  'U+0100-02BA,U+02BD-02C5,U+02C7-02CC,U+02CE-02D7,U+02DD-02FF,U+0304,U+0308,U+0329,U+1D00-1DBF,U+1E00-1E9F,U+1EF2-1EFF,U+2020,U+20A0-20AB,U+20AD-20C0,U+2113,U+2C60-2C7F,U+A720-A7FF';
const RANGE_LATIN =
  'U+0000-00FF,U+0131,U+0152-0153,U+02BB-02BC,U+02C6,U+02DA,U+02DC,U+0304,U+0308,U+0329,U+2000-206F,U+20AC,U+2122,U+2191,U+2193,U+2212,U+2215,U+FEFF,U+FFFD';
const face = (family, file, range, weights) =>
  `@font-face{font-family:'${family}';font-style:normal;font-weight:${weights};font-display:swap;src:url(data:font/woff2;base64,${b64(file)}) format('woff2');unicode-range:${range}}`;
const fonts = [
  face('Sora', 'sora-latin-ext-wght-normal.woff2', RANGE_EXT, '100 800'),
  face('Sora', 'sora-latin-wght-normal.woff2', RANGE_LATIN, '100 800'),
  face('Figtree', 'figtree-latin-ext-wght-normal.woff2', RANGE_EXT, '300 900'),
  face('Figtree', 'figtree-latin-wght-normal.woff2', RANGE_LATIN, '300 900'),
].join('\n');

// ---------- assemble ----------
const script = [read('src/strings.js'), read('src/motion.js'), read('src/app.js')].join('\n');
const sub = {
  '/*__FONTS_CSS__*/': fonts,
  '/*__TOKENS_CSS__*/': css.join('\n'),
  '/*__STYLES__*/': read('src/styles.css'),
  '/*__SCRIPT__*/': script,
  '__LOGO_DARK__': datauri('assets/brand/logo-reversed.svg'),
  '__LOGO_LIGHT__': datauri('assets/brand/logo.svg'),
  '__TOKEN_VERSION__': tokens.$meta.version,
};
let html = read('src/shell.html');
// split/join, not String.replace: the script text may contain dollar-ampersand sequences that replace() would expand
for (const [k, v] of Object.entries(sub)) html = html.split(k).join(v);
const out = resolve(proto, 'index.html');
writeFileSync(out, html);
console.log(`wrote ${out} (${(html.length / 1024).toFixed(0)} KB)`);
