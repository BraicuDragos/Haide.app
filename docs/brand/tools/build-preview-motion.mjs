/**
 * Builds docs/brand/preview-motion.html from preview-motion.template.html.
 * Everything visual comes from docs/brand/design-tokens.json (colours, durations, easings, shadows, depth),
 * fonts are embedded as base64 so the page is one self-contained file that works offline on a phone.
 *
 *   node docs/brand/tools/build-preview-motion.mjs
 *
 * Icons: Lucide (ISC licence, https://lucide.dev), path data vendored below. See ADR 0018.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '../../..');
const tokens = JSON.parse(readFileSync(resolve(root, 'docs/brand/design-tokens.json'), 'utf8'));
const fontDir = resolve(root, 'apps/web/public/fonts');
const b64 = (f) => readFileSync(resolve(fontDir, f)).toString('base64');
const datauri = (svgPath) =>
  'data:image/svg+xml;base64,' + readFileSync(resolve(root, svgPath)).toString('base64');

// ---------- contrast helpers (same maths as contrast.mjs) ----------
const parse = (c) => {
  let m = /^#([0-9a-f]{6})$/i.exec(c);
  if (m) {
    const n = parseInt(m[1], 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  }
  m = /^rgba?\(([^)]+)\)$/i.exec(c);
  const p = m[1].split(',').map(parseFloat);
  return p.slice(0, 3);
};
const lin = (v) => ((v /= 255) <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
const lum = ([r, g, b]) => 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
const ratio = (a, b) => {
  const [x, y] = [lum(parse(a)), lum(parse(b))];
  return ((Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05)).toFixed(2) + ':1';
};

// ---------- tokens -> CSS ----------
const css = [];
const root_ = [];
const kv = (prefix, obj) => Object.entries(obj ?? {}).forEach(([k, v]) => root_.push(`--tk-${prefix}-${k}: ${v};`));
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
    root_.push(`--tk-ease-${k}: ${fb};`);
    springs.push(`--tk-ease-${k}: ${v};`);
  } else root_.push(`--tk-ease-${k}: ${v};`);
}
css.push(`:root{${root_.join('')}}`);
css.push(`@supports (transition-timing-function: linear(0, 1)){:root{${springs.join('')}}}`);
for (const theme of ['dark', 'light']) {
  const vars = Object.entries(tokens.theme[theme]).map(([k, v]) => `--c-${k}:${v};`).join('');
  css.push(theme === 'dark' ? `:root,:root[data-theme=dark]{${vars}}` : `:root[data-theme=light]{${vars}}`);
}

// type scale utilities + font vars (mirrors the @utility type-* classes generated for the app)
const kebab = (s) => s.replace(/[A-Z]/g, (c) => '-' + c.toLowerCase());
css.push(`:root{--f-head:${tokens.font.family.heading};--f-base:${tokens.font.family.base};}`);
for (const [n, s] of Object.entries(tokens.font.scale))
  css.push(
    `.type-${kebab(n)}{font-family:var(--f-${s.family === 'heading' ? 'head' : 'base'});font-size:${s.size};line-height:${s.lineHeight};font-weight:${s.weight};letter-spacing:${s.letterSpacing};${s.fontFeature === 'tnum' ? 'font-variant-numeric:tabular-nums;' : ''}}`,
  );

// ---------- fonts ----------
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

// ---------- icons (Lucide, ISC) ----------
const ICONS = {
  'map-pin':
    '<path d="M20 10c0 4.993-5.539 10.193-7.399 11.799a1 1 0 0 1-1.202 0C9.539 20.193 4 14.993 4 10a8 8 0 0 1 16 0"/><circle cx="12" cy="10" r="3"/>',
  clock: '<circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/>',
  check: '<path d="M20 6 9 17l-5-5"/>',
  'rotate-ccw': '<path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/>',
  armchair:
    '<path d="M19 9V6a2 2 0 0 0-2-2H7a2 2 0 0 0-2 2v3"/><path d="M3 16a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-5a2 2 0 0 0-4 0v1.5a.5.5 0 0 1-.5.5h-9a.5.5 0 0 1-.5-.5V11a2 2 0 0 0-4 0z"/><path d="M5 18v2"/><path d="M19 18v2"/>',
  route: '<path d="M9 5h8.5a1 1 0 0 1 0 7h-11a1 1 0 0 0 0 7H15"/><circle cx="18" cy="19" r="3"/><circle cx="6" cy="5" r="3"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2"/><path d="M12 20v2"/><path d="m4.93 4.93 1.41 1.41"/><path d="m17.66 17.66 1.41 1.41"/><path d="M2 12h2"/><path d="M20 12h2"/><path d="m6.34 17.66-1.41 1.41"/><path d="m19.07 4.93-1.41 1.41"/>',
  moon: '<path d="M20.985 12.486a9 9 0 1 1-9.473-9.472c.405-.022.617.46.402.803a6 6 0 0 0 8.268 8.268c.344-.215.825-.004.803.401"/>',
  user: '<path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/>',
  search: '<path d="m21 21-4.34-4.34"/><circle cx="11" cy="11" r="8"/>',
  'footprints':
    '<path d="M4 16v-2.38C4 11.5 2.97 10.5 3 8c.03-2.72 1.49-6 4.5-6C9.37 2 10 3.8 10 5.5c0 3.11-2 5.66-2 8.68V16a2 2 0 1 1-4 0Z"/><path d="M20 20v-2.38c0-2.12 1.03-3.12 1-5.62-.03-2.72-1.49-6-4.5-6C14.63 6 14 7.8 14 9.5c0 3.11 2 5.66 2 8.68V20a2 2 0 1 0 4 0Z"/><path d="M16 17h4"/><path d="M4 13h4"/>',
};
const sprite = Object.entries(ICONS)
  .map(
    ([k, v]) =>
      `<symbol id="i-${k}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="${tokens.sizing.iconStroke}" stroke-linecap="round" stroke-linejoin="round">${v}</symbol>`,
  )
  .join('');

// ---------- palette swatches ----------
const SW = [
  ['bg-deep', 'Map and deepest layer', 'text', 'bg-deep'],
  ['bg', 'Page', 'text', 'bg'],
  ['surface', 'Cards and sheets', 'text', 'surface'],
  ['surface-subtle', 'Raised and tonal', 'text-muted', 'surface-subtle'],
  ['price', 'Route, price, key action', 'price', 'surface'],
  ['savings', 'Money saved', 'savings', 'surface'],
  ['link', 'Links, outline buttons', 'link', 'surface'],
  ['text-muted', 'Secondary text', 'text-muted', 'surface'],
];
const swatches = SW.map(([role, use, fg, bg]) => {
  const d = tokens.theme.dark, l = tokens.theme.light;
  const val = (t) => t[role].toUpperCase();
  const r = (t) => ratio(t[fg], t[bg]);
  const what = role === 'price' || role === 'savings' || role === 'link' || role === 'text-muted' ? 'on card' : 'text on it';
  return `<li class="sw"><span class="chip" style="background:var(--c-${role})"></span><span class="sw-n">${role}</span><span class="sw-u">${use}</span><span class="sw-h dk">${val(d)}</span><span class="sw-h lt">${val(l)}</span><span class="sw-r dk">${r(d)} ${what}</span><span class="sw-r lt">${r(l)} ${what}</span></li>`;
}).join('');

// ---------- easing plots ----------
function bezier(str) {
  const [x1, y1, x2, y2] = str.match(/-?[\d.]+/g).map(Number);
  const cx = (t) => 3 * x1 * (1 - t) ** 2 * t + 3 * x2 * (1 - t) * t * t + t ** 3;
  const cy = (t) => 3 * y1 * (1 - t) ** 2 * t + 3 * y2 * (1 - t) * t * t + t ** 3;
  return (x) => {
    let lo = 0, hi = 1;
    for (let i = 0; i < 30; i++) {
      const m = (lo + hi) / 2;
      cx(m) < x ? (lo = m) : (hi = m);
    }
    return cy((lo + hi) / 2);
  };
}
function curve(str) {
  if (str === 'linear') return (x) => x;
  if (str.startsWith('linear(')) {
    const pts = str.match(/-?[\d.]+/g).map(Number);
    return (x) => {
      const f = x * (pts.length - 1), i = Math.min(Math.floor(f), pts.length - 2);
      return pts[i] + (pts[i + 1] - pts[i]) * (f - i);
    };
  }
  return bezier(str);
}
const PLOT = [
  ['standard', 'Default for UI changes'],
  ['momentum', 'Gathers speed, glides in. Route draw-in'],
  ['departure', 'Accelerates away, the launch'],
  ['spring', 'Settles, 8% overshoot'],
  ['magnet', 'Snaps, 20% overshoot'],
];
const plots = PLOT.map(([k, use]) => {
  const f = curve(tokens.motion.easing[k]);
  const W = 96, H = 64, pad = 8;
  const pts = Array.from({ length: 49 }, (_, i) => {
    const x = i / 48, y = f(x);
    return `${(pad + x * (W - 2 * pad)).toFixed(1)},${(H - pad - Math.max(-0.1, Math.min(1.35, y)) * (H - 2 * pad - 6)).toFixed(1)}`;
  }).join(' ');
  const base = (H - pad).toFixed(1);
  const top = (H - pad - (H - 2 * pad - 6)).toFixed(1);
  return `<li class="ez"><svg viewBox="0 0 ${W} ${H}" aria-hidden="true"><path d="M${pad} ${base}H${W - pad}M${pad} ${top}H${W - pad}" class="ez-g"/><polyline points="${pts}" class="ez-l"/></svg><span class="ez-n">${k}</span><span class="ez-u">${use}</span></li>`;
}).join('');
const durs = Object.entries(tokens.motion.duration)
  .map(([k, v]) => `<li class="du"><span class="du-n">${k}</span><span class="du-b" style="--w:${Math.min(100, (parseFloat(v) / 2400) * 100).toFixed(1)}%"></span><span class="du-v">${v}</span></li>`)
  .join('');

// ---------- assemble ----------
let html = readFileSync(resolve(here, 'preview-motion.template.html'), 'utf8');
const sub = {
  '/*__TOKENS_CSS__*/': css.join('\n'),
  '/*__FONTS_CSS__*/': fonts,
  '__SPRITE__': sprite,
  '__LOGO_DARK__': datauri('assets/brand/logo-reversed.svg'),
  '__LOGO_LIGHT__': datauri('assets/brand/logo.svg'),
  '__SWATCHES__': swatches,
  '__PLOTS__': plots,
  '__DURATIONS__': durs,
  '__GRAIN__': tokens.depth.grain.image,
  '__TOKEN_VERSION__': tokens.$meta.version,
};
for (const [k, v] of Object.entries(sub)) html = html.split(k).join(v);
const out = resolve(root, 'docs/brand/preview-motion.html');
writeFileSync(out, html);
console.log(`wrote ${out} (${(html.length / 1024).toFixed(0)} KB)`);
