/**
 * Records the signature-moment demos in docs/brand/preview-motion.html as GIFs (and a reduced-motion PNG per demo).
 * Frame-accurate: every animation is a Web Animations API animation, so the script pauses them and steps
 * `currentTime` instead of racing the wall clock. Output is identical on every run and on slow machines.
 *
 *   one-off setup (outside the repo, nothing is added to package.json):
 *     npm i --prefix <scratch dir> gifenc pngjs
 *   run:
 *     GIF_LIBS=<scratch dir>/node_modules node docs/brand/tools/record-motion.mjs [route|match|price|launch|seats|loading]
 *
 * Needs the repo's Playwright (@playwright/test) and its Chromium. No ffmpeg required.
 * The page grain is switched off while recording (html.rec) because 256-colour GIFs turn film grain into noise and balloon.
 */
import { createRequire } from 'node:module';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '../../..');
const out = resolve(root, 'docs/screenshots/design-motion');
mkdirSync(out, { recursive: true });
const req = createRequire(resolve(root, 'package.json'));
const { chromium } = req('@playwright/test');
const libs = createRequire(resolve(process.env.GIF_LIBS ?? '.', 'x.js'));
const { GIFEncoder, quantize, applyPalette } = libs('gifenc');
const { PNG } = libs('pngjs');

const FPS = 20;
const only = process.argv[2];
const THEME = process.env.THEME ?? 'dark';

/** Each demo: the element to film and a script of segments. A segment starts something, then plays `ms` of it. */
const demos = {
  route: { clip: '#route-stage', segs: [{ start: (p) => p.evaluate(() => __haide.play.route()), ms: 3900 }] },
  match: { clip: '#match-stage', segs: [{ start: (p) => p.evaluate(() => __haide.play.match()), ms: 1900 }, { hold: 900 }] },
  price: {
    clip: '#price-card',
    segs: [
      { start: (p) => p.evaluate(() => __haide.play.price()), ms: 1500 },
      { hold: 700 },
      { start: (p) => p.click('#p-join'), ms: 1500 },
      { hold: 900 },
    ],
  },
  launch: {
    clip: '#launch .card',
    segs: [
      { hold: 700 },
      { start: (p) => p.click('#cta'), ms: 1500 },
      { hold: 1000 },
    ],
  },
  seats: {
    clip: '#seats-card',
    segs: [
      { hold: 600 },
      { start: (p) => p.click('.seat:nth-child(3)'), ms: 1100 },
      { hold: 500 },
      { start: (p) => p.click('.seat:nth-child(1)'), ms: 900 },
      { hold: 600 },
    ],
  },
  loading: { clip: '#loading .duo', segs: [{ start: (p) => p.evaluate(() => __haide.play.loader()), ms: 3600 }] },
};

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1 });
await page.goto(pathToFileURL(resolve(root, 'docs/brand/preview-motion.html')).href);
await page.evaluate((t) => {
  document.documentElement.classList.add('rec');
  __haide.io.disconnect(); // no autoplay or pause logic while we drive time by hand
  __haide.setTheme(t);
}, THEME);
await page.addStyleTag({ content: '.bar{position:static!important}' }); // keep the sticky bar out of the frame

const png = (buf) => PNG.sync.read(buf);
async function shot(clipEl) {
  const box = await clipEl.boundingBox();
  const buf = await page.screenshot({ clip: { x: Math.round(box.x), y: Math.round(box.y), width: Math.round(box.width), height: Math.round(box.height) } });
  return png(buf);
}
// Only animations created by the current segment are stepped; earlier ones are parked at their end state.
const park = () =>
  page.evaluate(() => {
    document.getAnimations().forEach((a) => {
      if (a.effect.getComputedTiming().iterations !== Infinity) a.finish();
      a.pause();
    });
    window.__prev = new Set(document.getAnimations());
  });
const seek = (t) =>
  page.evaluate((t) => document.getAnimations().forEach((a) => { if (!window.__prev.has(a)) { a.pause(); a.currentTime = t; } }), t);

for (const [name, d] of Object.entries(demos)) {
  if (only && only !== name) continue;
  await page.evaluate(() => document.getAnimations().forEach((a) => a.cancel()));
  await page.reload();
  await page.evaluate((t) => { document.documentElement.classList.add('rec'); __haide.io.disconnect(); __haide.setTheme(t); }, THEME);
  await page.addStyleTag({ content: '.bar{position:static!important}' });
  const el = page.locator(d.clip).first();
  await el.scrollIntoViewIfNeeded();
  await page.evaluate((s) => { const e = document.querySelector(s); e.scrollIntoView({ block: 'center' }); }, d.clip);
  await page.waitForTimeout(300);
  const frames = [];
  let last = await shot(await el.elementHandle());
  for (const seg of d.segs) {
    if (seg.hold) {
      for (let i = 0; i < Math.round((seg.hold / 1000) * FPS); i++) frames.push(last);
      continue;
    }
    await park();
    await seg.start(page);
    const n = Math.round((seg.ms / 1000) * FPS);
    for (let i = 0; i <= n; i++) {
      await seek((i / FPS) * 1000);
      last = await shot(await el.elementHandle());
      frames.push(last);
    }
    // let the end state settle (animations finish, DOM text changes are already in place)
  }
  if (process.env.DUMP) {
    // QA aid: DUMP=<dir> writes ~8 evenly spaced frames per demo as PNG so they can be eyeballed
    mkdirSync(process.env.DUMP, { recursive: true });
    for (let k = 0; k < 8; k++) {
      const f = frames[Math.round((k / 7) * (frames.length - 1))];
      writeFileSync(resolve(process.env.DUMP, `${name}-${k}.png`), PNG.sync.write(f));
    }
  }
  // ---- encode: one global palette, frame differencing against the previous frame ----
  const { width, height } = frames[0];
  const sample = [];
  frames.forEach((f, i) => { if (i % 3 === 0) for (let p = 0; p < f.data.length; p += 16) sample.push(f.data[p], f.data[p + 1], f.data[p + 2], 255); });
  const pal = quantize(Uint8Array.from(sample), 255, { format: 'rgb444' });
  pal.push([0, 0, 0]); // index 255 = transparent
  const T = 255;
  const gif = GIFEncoder();
  let prev = null;
  frames.forEach((f, i) => {
    const idx = applyPalette(f.data, pal.slice(0, 255), 'rgb444');
    const frame = new Uint8Array(idx);
    if (prev) for (let p = 0; p < frame.length; p++) if (frame[p] === prev[p]) frame[p] = T;
    gif.writeFrame(frame, width, height, { palette: pal, delay: Math.round(1000 / FPS), transparent: !!prev, transparentIndex: T, dispose: 1, repeat: i === 0 ? 0 : undefined });
    prev = new Uint8Array(idx);
  });
  gif.finish();
  const file = resolve(out, `${name}${THEME === 'dark' ? '' : '-' + THEME}.gif`);
  writeFileSync(file, gif.bytes());
  console.log(`${name}: ${frames.length} frames ${width}x${height} -> ${(gif.bytes().length / 1024).toFixed(0)} KB`);
}

// reduced-motion stills, one PNG per demo (the calm fallback, as the owner would see it with the OS setting on)
if (!only) {
  await page.reload();
  await page.evaluate((t) => { document.documentElement.classList.add('rec'); __haide.io.disconnect(); __haide.setTheme(t); __haide.setMotion(true); }, THEME);
  await page.addStyleTag({ content: '.bar{position:static!important}' });
  for (const [name, d] of Object.entries(demos)) {
    const el = page.locator(d.clip).first();
    await page.evaluate((s) => document.querySelector(s).scrollIntoView({ block: 'center' }), d.clip);
    if (name === 'launch') await page.click('#cta');
    await page.waitForTimeout(150);
    await el.screenshot({ path: resolve(out, `reduced-${name}.png`) });
  }
  console.log('reduced-motion stills written');
}
await browser.close();
