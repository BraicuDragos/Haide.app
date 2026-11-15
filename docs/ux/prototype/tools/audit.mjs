/**
 * Scripted accessibility and layout audit of the clickable prototype (WCAG 2.1 AA checks that can be automated).
 * For every screen state it checks: horizontal overflow, touch targets (44 px), accessible names, duplicate ids, one h1,
 * one primary action, minimum text size, text contrast (computed from the rendered colours, alpha composited), keyboard focus
 * visibility on the first tab stops, and that Romanian glyphs resolve to a loaded font.
 *
 *   node docs/ux/prototype/tools/audit.mjs [--theme dark|light] [--width 360] [--reduced] [--shots dir]
 *
 * Needs @playwright/test in the repo root node_modules and Chrome. Set CHROME_PATH if Chrome is not in the default Windows location.
 * Not a replacement for a screen-reader pass or a Lighthouse run on the real build (see docs/ux/accessibility.md section 8).
 */
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { mkdirSync } from 'node:fs';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '../../../..');
const require = createRequire(resolve(root, 'package.json'));
const { chromium } = require('@playwright/test');
const arg = (n, d) => { const i = process.argv.indexOf('--' + n); return i < 0 ? d : (process.argv[i + 1]?.startsWith('--') || process.argv[i + 1] === undefined ? true : process.argv[i + 1]); };
const theme = arg('theme', 'dark'), width = +arg('width', 360), reduced = !!arg('reduced', false), shots = arg('shots', '');
const chrome = process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const url = pathToFileURL(resolve(here, '../index.html')).href;
if (shots) mkdirSync(shots, { recursive: true });

const browser = await chromium.launch({ executablePath: chrome, headless: true });
const ctx = await browser.newContext({ viewport: { width, height: 780 }, deviceScaleFactor: 2, colorScheme: theme, reducedMotion: reduced ? 'reduce' : 'no-preference' });
const page = await ctx.newPage();
const pageErrors = [];
page.on('pageerror', (e) => pageErrors.push(e.message));
page.on('console', (m) => { if (m.type() === 'error') pageErrors.push(m.text()); });
await page.goto(url);
await page.waitForTimeout(400);

/* ---------- states: set the prototype state directly, then navigate ---------- */
const BOOK = (status, extra = '') => `S.booking={r:'r1',v:RES['cis>centre'][0],status:'${status}',lock:${status === 'confirmed' ? 3.8 : 'null'},queued:false,rated:false,dropped:false,unread:false};${extra}`;
const STATES = [
  ['find', 'visitor', '', '#/find'],
  ['find-error', 'visitor', "syncSearch(); S.errs.search = t('find.err.missing');", '#/find'],
  ['picker', 'visitor', '', '#/find', "openPicker('from')"],
  ['results-loading', 'visitor', "S.search.from='p1';S.search.to='p4';S.key='cis>centre';S.loading=true;", '#/results'],
  ['results', 'visitor', "S.search.from='p1';S.search.to='p4';S.key='cis>centre';", '#/results'],
  ['results-empty', 'visitor', "S.search.from='p1';S.search.to='p8';S.key='cis>zi';", '#/results'],
  ['results-error', 'visitor', "S.search.from='p1';S.search.to='p4';S.key='cis>centre';S.searchError=true;", '#/results'],
  ['detail', 'visitor', "S.search.from='p1';S.search.to='p4';S.key='cis>centre';", '#/ride/r1/0'],
  ['request-sheet', 'ioana', "S.search.from='p1';S.search.to='p4';S.key='cis>centre';", '#/ride/r1/0', "openRequest('r1','0')"],
  ['auth', 'visitor', '', '#/auth'],
  ['auth-check', 'visitor', "S.authEmail='ioana@example.com';", '#/auth/check'],
  ['consent', 'visitor', "S.user={email:'x@example.com'};", '#/auth/consent'],
  ['setup-profile', 'visitor', "S.user={email:'x@example.com'};S.consent=true;S.errs={firstName:t('profile.err.name'),phone:t('profile.err.phone'),photo:t('profile.err.photo')};", '#/setup/profile'],
  ['setup-vehicle', 'visitor', "S.user={email:'x@example.com'};S.consent=true;S.intent={kind:'offer',back:'#/offer'};", '#/setup/vehicle'],
  ['offer-gate', 'ioana', '', '#/offer'],
  ['offer', 'andrei', "S.offer.from='p3';S.offer.to='p7';S.offer.route={km:9.588,min:17};S.offer.routeState='ok';", '#/offer'],
  ['offer-done', 'andrei', "S.publishedId='d1';", '#/offer/done'],
  ['rides-empty', 'ioana', '', '#/rides'],
  ['rides-requested', 'ioana', BOOK('requested'), '#/rides'],
  ['rides-driving', 'andrei', "S.ridesRole='driving';", '#/rides'],
  ['booking-requested', 'ioana', BOOK('requested'), '#/booking'],
  ['booking-confirmed', 'ioana', BOOK('confirmed'), '#/booking'],
  ['booking-live', 'ioana', BOOK('confirmed', "S.phase='day';"), '#/booking'],
  ['booking-dropped', 'ioana', BOOK('confirmed', 'S.extraJoined=1;S.booking.dropped=true;S.booking.lock=1.9;'), '#/booking'],
  ['booking-after', 'ioana', BOOK('confirmed', "S.phase='after';"), '#/booking'],
  ['booking-declined', 'ioana', BOOK('rejected'), '#/booking'],
  ['rate', 'ioana', BOOK('confirmed', "S.phase='after';"), '#/rate/driver'],
  ['driver-ride', 'andrei', '', '#/driving/d1'],
  ['driver-ride-after', 'andrei', "S.phase='after';S.driving[0].pax=[{id:'q1',u:'alexandra',phone:'0724 300 111',noShow:false},{id:'q2',u:'bogdan',phone:'0724 300 112',noShow:false}];S.driving[0].requests=[];", '#/driving/d1'],
  ['profile', 'ioana', '', '#/profile'],
  ['profile-visitor', 'visitor', '', '#/profile'],
  ['user', 'ioana', '', '#/user/radu'],
  ['settings', 'ioana', '', '#/settings'],
  ['delete', 'ioana', '', '#/delete'],
  ['policy', 'ioana', '', '#/policy/privacy'],
  ['not-found', 'ioana', '', '#/nope'],
];

/* ---------- checks run inside the page ---------- */
const inPage = () => {
  const out = []; let nTargets = 0, nText = 0, minR = 99, minWhat = '';
  const isVisible = (el) => { const r = el.getBoundingClientRect(); const cs = getComputedStyle(el); return r.width > 0 && r.height > 0 && cs.visibility !== 'hidden' && cs.display !== 'none'; };
  const srOnly = (el) => !!el.closest('.sr-only');
  const dev = el => `${el.tagName.toLowerCase()}${el.id ? '#' + el.id : ''}${el.className && typeof el.className === 'string' ? '.' + el.className.trim().split(/\s+/).slice(0, 2).join('.') : ''} "${(el.getAttribute('aria-label') || el.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 30)}"`;
  const scope = document.querySelector('#sheets.open .sheet') || document.querySelector('#app');
  // overflow
  const main = document.querySelector('#main');
  if (main && main.scrollWidth > main.clientWidth + 1) out.push(['overflow', `main scrollWidth ${main.scrollWidth} > ${main.clientWidth}`]);
  // touch targets
  scope.querySelectorAll('a[href],button,input:not([type=hidden]),select,textarea,[role=tab],[role=switch]').forEach((el) => {
    if (!isVisible(el) || srOnly(el) || el.disabled) return;
    if (el.type === 'file') return;
    let box = el.getBoundingClientRect();
    const cs = getComputedStyle(el);
    if (el.tagName === 'A' && cs.display === 'inline' && el.closest('p,label,li,span')) return; // inline text link: WCAG exception
    if ((el.type === 'checkbox' || el.type === 'radio') && cs.opacity === '0') { /* hidden native input inside a chip or seat: the label is the target */ box = (el.closest('label') || el).getBoundingClientRect(); }
    if (el.type === 'checkbox' && !el.closest('.chip,.seat,.proto-panel') && el.closest('label,.check,.switch')) { const row = el.closest('.check,.switch'); if (row) box = row.getBoundingClientRect(); }
    nTargets++;
    if (box.width < 43.5 || box.height < 43.5) out.push(['target', `${Math.round(box.width)}x${Math.round(box.height)} ${dev(el)}`]);
  });
  // accessible names
  scope.querySelectorAll('a[href],button,input:not([type=hidden]),select,textarea,[role=tab],[role=switch]').forEach((el) => {
    if (!isVisible(el) && el.type !== 'radio' && el.type !== 'checkbox') return;
    if (el.closest('.sr-only')) return;
    const labelled = el.getAttribute('aria-label') || el.getAttribute('aria-labelledby') || (el.labels && el.labels.length && [...el.labels].some(l => l.textContent.trim())) || el.textContent.trim() || el.getAttribute('title');
    if (!labelled) out.push(['name', dev(el)]);
  });
  // ids
  const ids = {}; document.querySelectorAll('[id]').forEach(e => { ids[e.id] = (ids[e.id] || 0) + 1; });
  Object.entries(ids).filter(([, n]) => n > 1).forEach(([i]) => out.push(['dup-id', i]));
  // headings and primary action
  const h1 = document.querySelectorAll('#app h1').length; if (h1 !== 1) out.push(['h1', `${h1} h1 elements`]);
  const prim = [...scope.querySelectorAll('.btn.primary')].filter(isVisible); if (prim.length > 1) out.push(['primary', `${prim.length} primary actions: ${prim.map(dev).join(' | ')}`]);
  // text size and contrast
  const parse = (c) => { const m = c.match(/rgba?\(([^)]+)\)/); if (!m) return null; const p = m[1].split(/[ ,/]+/).filter(Boolean).map(parseFloat); return { r: p[0], g: p[1], b: p[2], a: p[3] === undefined ? 1 : p[3] }; };
  const over = (f, b) => ({ r: f.r * f.a + b.r * (1 - f.a), g: f.g * f.a + b.g * (1 - f.a), b: f.b * f.a + b.b * (1 - f.a), a: 1 });
  const L = (c) => { const f = v => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }; return 0.2126 * f(c.r) + 0.7152 * f(c.g) + 0.0722 * f(c.b); };
  const ratio = (a, b) => { const x = L(a), y = L(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };
  const bgOf = (el) => {
    const chain = []; for (let e = el; e; e = e.parentElement) { const c = parse(getComputedStyle(e).backgroundColor); if (c && c.a > 0) { chain.push(c); if (c.a === 1) break; } }
    let base = parse(getComputedStyle(document.body).backgroundColor); if (!chain.length || chain[chain.length - 1].a < 1) base = over(base.a < 1 ? { r: 14, g: 13, b: 38, a: 1 } : base, { r: 0, g: 0, b: 0, a: 1 });
    let acc = chain.length && chain[chain.length - 1].a === 1 ? chain.pop() : base; while (chain.length) acc = over(chain.pop(), acc); return acc;
  };
  const seen = new Set();
  const walker = document.createTreeWalker(scope, NodeFilter.SHOW_TEXT);
  for (let n; (n = walker.nextNode());) {
    const txt = n.textContent.trim(); const el = n.parentElement;
    if (!txt || seen.has(el) || el.closest('.sr-only,svg,script,style,[hidden]') || !isVisible(el)) continue; seen.add(el);
    if (el.closest('.mapwrap')) continue;
    let hidden = false; for (let e = el; e && e !== document.body; e = e.parentElement) if (getComputedStyle(e).opacity === '0') hidden = true;
    if (hidden) continue; // animation parts that are not shown in the current state (launch button confirmed text, Haide!)
    const cs = getComputedStyle(el); const fs = parseFloat(cs.fontSize);
    if (fs < 12 - 0.01) out.push(['font', `${fs}px ${dev(el)}`]);
    if (el.disabled || el.closest('[aria-disabled=true]:not(.cta)')) continue;
    const fg = parse(cs.color); if (!fg) continue; const bg = bgOf(el); const eff = over(fg, bg);
    const large = fs >= 24 || (fs >= 18.66 && parseInt(cs.fontWeight) >= 700);
    const need = large ? 3 : 4.5, r = ratio(eff, bg); nText++;
    if (r / need < minR) { minR = r / need; minWhat = r.toFixed(2) + ':1 ' + dev(el); }
    if (r < need) out.push(['contrast', `${r.toFixed(2)}:1 < ${need} ${dev(el)} (${cs.color} on rgb(${Math.round(bg.r)},${Math.round(bg.g)},${Math.round(bg.b)}))`]);
  }
  out.push(['stat', `${nTargets} targets, ${nText} text blocks, tightest contrast ${minWhat}`]);
  return out;
};

const focusCheck = async () => {
  const bad = [];
  await page.evaluate(() => { (document.querySelector('#sheets.open .sheet') || document.querySelector('#main')).focus(); document.activeElement.blur(); });
  for (let i = 0; i < 6; i++) {
    await page.keyboard.press('Tab');
    const r = await page.evaluate(() => {
      const e = document.activeElement; if (!e || e === document.body) return null;
      const cs = getComputedStyle(e); const sty = `${cs.outlineStyle} ${cs.outlineWidth}`;
      const wrap = e.closest('.chip,.seat,.starpick label,.proto-panel label.opt');
      const ws = wrap ? getComputedStyle(wrap) : null;
      const ring = (cs.outlineStyle !== 'none' && parseFloat(cs.outlineWidth) >= 2) || (ws && ws.outlineStyle !== 'none' && parseFloat(ws.outlineWidth) >= 2) || !!(e.closest('.seat') && getComputedStyle(e.closest('.seat').querySelector('.face')).outlineStyle !== 'none');
      return { ring, what: `${e.tagName.toLowerCase()}${e.id ? '#' + e.id : ''} ${(e.getAttribute('aria-label') || e.textContent || '').trim().slice(0, 24)}`, sty };
    });
    if (r && !r.ring) bad.push(['focus', `no visible focus ring on ${r.what} (${r.sty})`]);
  }
  return bad;
};

let total = 0; const summary = [];
for (const [name, persona, setup, hash, after] of STATES) {
  await page.evaluate(([p, s]) => { document.querySelectorAll('input[name=persona]').length; if (typeof SHEET !== 'undefined' && SHEET) closeSheet(true); S = freshState(p); eval(s); }, [persona, setup]);
  await page.evaluate((h) => { history.replaceState({ i: 0 }, '', h); render(); }, hash);
  if (after) await page.evaluate((a) => eval(a), after);
  await page.waitForTimeout(reduced ? 150 : 1700);
  const all = [...(await page.evaluate(inPage)), ...(await focusCheck())];
  const stat = all.find(([k]) => k === 'stat'); const findings = all.filter(([k]) => k !== 'stat');
  if (shots) await page.screenshot({ path: `${shots}/${name}.png` });
  total += findings.length;
  summary.push([name, findings]);
  console.log(`${findings.length ? 'FAIL' : 'ok  '} ${name.padEnd(18)} ${stat ? stat[1] : ''}${findings.length ? '\n' + findings.map(([k, v]) => `       [${k}] ${v}`).join('\n') : ''}`);
}
const glyph = await page.evaluate(async () => { const str = 'Ștefan Țepeș, Șelimbăr, Păltiniș, Bâlea, Cisnădie'; const r = []; for (const f of ['Sora', 'Figtree']) { await document.fonts.load(`600 16px ${f}`, str); r.push([f, document.fonts.check(`600 16px ${f}`, str)]); } return r; });
console.log('\nRomanian glyphs resolve to loaded fonts:', JSON.stringify(glyph));
console.log(`page errors: ${pageErrors.length}${pageErrors.length ? '\n' + pageErrors.join('\n') : ''}`);
console.log(`\n${theme}, ${width}px${reduced ? ', reduced motion' : ''}: ${STATES.length} states, ${total} findings`);
await browser.close();
process.exitCode = total || pageErrors.length ? 1 : 0;
