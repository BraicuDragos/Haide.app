/* ================= Haide motion helpers (the part that would ship in the app, about 1.5 KB gzip) =================
   Rules (ADR 0019, docs/ux/motion.md): animate transform and opacity only. The one exception is the one-shot route
   draw-in (stroke-dashoffset). Durations and easings are read from the token custom properties (--tk-dur-*, --tk-ease-*),
   never typed here. Base CSS is always the calm final state: reduced motion simply means "do not start the animation". */
const M = (() => {
  const R = document.documentElement;
  const q = (s, r = document) => r.querySelector(s);
  const qa = (s, r = document) => [...r.querySelectorAll(s)];
  const css = n => getComputedStyle(R).getPropertyValue(n).trim();
  const ms = n => parseFloat(css('--tk-dur-' + n));
  const ease = n => css('--tk-ease-' + n);
  const STEP = () => parseFloat(css('--tk-stagger-step'));
  const MAXS = () => parseFloat(css('--tk-stagger-max'));
  const dist = n => css('--tk-travel-' + n);
  const reduced = () => R.dataset.motion === 'reduced';
  const run = (el, kf, o) => el.animate(kf, { fill: 'backwards', ...o });
  const stop = root => root.getAnimations({ subtree: true }).forEach(a => a.cancel());
  const stag = i => Math.min(i * STEP(), MAXS());

  /* ---- path sampling: the travelling light is an HTML element moved with transform (compositor), not an SVG animation ---- */
  const sample = (path, n = 48) => {
    const L = path.getTotalLength();
    return Array.from({ length: n + 1 }, (_, i) => path.getPointAtLength((L * i) / n));
  };
  const tr = p => `translate(${p.x.toFixed(1)}px,${p.y.toFixed(1)}px)`;
  const ride = (el, pts, o) => run(el, pts.map(p => ({ transform: tr(p) })), { fill: 'both', ...o });
  /** Ambient pulse: travels for 62% of the cycle (sine-eased along the path), then rests. */
  const loop = (el, pts, o) => {
    const n = pts.length - 1, T = 0.62, peak = o.peak ?? 1;
    const at = u => {
      const f = (0.5 - 0.5 * Math.cos(Math.PI * u)) * n, i = Math.min(Math.floor(f), n - 1), k = f - i;
      return { x: pts[i].x + (pts[i + 1].x - pts[i].x) * k, y: pts[i].y + (pts[i + 1].y - pts[i].y) * k };
    };
    const kf = pts.map((_, i) => ({ offset: (i / n) * T, transform: tr(at(i / n)), opacity: peak * Math.min(1, i / 6, (n - i) / 6) }));
    kf.push({ offset: 1, transform: tr(pts[n]), opacity: 0 });
    return run(el, kf, { duration: o.duration, delay: o.delay ?? 0, iterations: Infinity, easing: 'linear', fill: 'both' });
  };

  /* ---- odometer digits: each digit is a clipped strip 0-9 twice, moved with transform only ---- */
  const rollInit = (el, text) => {
    el.textContent = ''; el._s = [];
    for (const ch of text) {
      if (/\d/.test(ch)) {
        const d = document.createElement('span'), s = document.createElement('span');
        d.className = 'dg'; s.className = 'st';
        s.innerHTML = '01234567890123456789'.split('').map(c => `<i>${c}</i>`).join('');
        d.append(s); el.append(d); el._s.push(s);
      } else { const c = document.createElement('span'); c.className = 'sep'; c.textContent = ch; el.append(c); }
    }
    el.dataset.v = text;
  };
  const ty = i => `translateY(${-i * 5}%)`;
  const digitsOf = t => [...t].filter(c => /\d/.test(c)).map(Number);
  /** Set (and optionally roll to) a number. from === 0 rolls in from zero, otherwise a change rolls from where each digit is. */
  const rollSet = (el, text, { from, animate, delay = 0, easing } = {}) => {
    const to = digitsOf(text);
    if (!el._s || el._s.length !== to.length) rollInit(el, text);
    el._s.forEach((s, i) => {
      const end = to[i] + 10, start = from === 0 ? 0 : (s._v ?? end);
      s.style.transform = ty(end); s._v = end;
      if (animate && !reduced() && start !== end) run(s, [{ transform: ty(start) }, { transform: ty(end) }], { duration: ms('reveal'), delay: delay + stag(i), easing: easing || ease('spring') });
    });
    el.dataset.v = text;
  };

  /* ---- scale the HTML light layer with the SVG (viewBox units to pixels) ---- */
  const fit = root => qa('.mapwrap[data-w]', root).forEach(m => m.style.setProperty('--k', m.clientWidth / m.dataset.w));

  /* ---- endless loops pause while off screen and while the tab is hidden ---- */
  const inf = a => a.effect && a.effect.getComputedTiming().iterations === Infinity;
  const seen = new Set();
  const io = new IntersectionObserver(es => es.forEach(e => {
    e.isIntersecting ? seen.add(e.target) : seen.delete(e.target);
    e.target.getAnimations({ subtree: true }).filter(inf).forEach(a => (e.isIntersecting && !document.hidden ? a.play() : a.pause()));
  }), { threshold: 0.2 });
  document.addEventListener('visibilitychange', () => qa('.mapwrap,.ambient').forEach(el => el.getAnimations({ subtree: true }).filter(inf).forEach(a => (!document.hidden && seen.has(el) ? a.play() : a.pause()))));
  const watch = el => io.observe(el);
  const unwatch = () => { io.disconnect(); seen.clear(); };

  /* ================= 1. Route draw-in + travelling light (map frames) ================= */
  const once = new Set();
  const maps = (root, { draw: want = false } = {}) => qa('.mapframe', root).forEach(fr => {
    const k = fr.dataset.once, draw = want && !(k && once.has(k)); if (k) once.add(k);
    const wrap = q('.mapwrap', fr), core = q('.rt.core', wrap);
    if (!core) return;
    fit(fr);
    const pts = sample(core, 64);
    const still = q('.pl.still', wrap); if (still) still.style.transform = tr(pts[32]);
    watch(wrap);
    if (reduced()) return;
    const fx = q('.fx', wrap), D = ms('draw'), P = ms('pulse'), T0 = 100;
    if (draw) {
      qa('.rt', wrap).forEach((p, i) => run(p, [{ strokeDashoffset: 1 }, { strokeDashoffset: 0 }], { duration: D, delay: T0 + (i % 2) * 30, easing: ease('momentum') }));
      const pk = q('.pk', wrap); if (pk) run(pk, [{ transform: 'scale(0)' }, { transform: 'scale(1)' }], { duration: ms('slow'), easing: ease('spring') });
      const ping = q('.ping', wrap); if (ping) run(ping, [{ transform: 'scale(1)', opacity: 0.9 }, { transform: 'scale(3)', opacity: 0 }], { duration: ms('reveal'), delay: 60, easing: ease('standard') });
      const dp = q('.dp', wrap); if (dp) run(dp, [{ transform: 'scale(0)' }, { transform: 'scale(1)' }], { duration: ms('slow'), delay: T0 + D * 0.45, easing: ease('spring') });
      const hd = q('.pl.hd', fx);
      if (hd) {
        ride(hd, pts, { duration: D, delay: T0, easing: ease('momentum') });
        run(hd, [{ opacity: 0 }, { opacity: 1, offset: 0.05 }, { opacity: 1, offset: 0.7 }, { opacity: 0 }], { duration: D, delay: T0, easing: 'linear', composite: 'replace', fill: 'both' });
      }
    }
    const t0 = draw ? T0 + D : 0;
    qa('.pl.t', fx).forEach((t, i) => loop(t, pts, { duration: P, delay: t0 + 70 * (i + 1), peak: [0.6, 0.35, 0.18][i] }));
    const amb = q('.pl.amb', fx); if (amb) loop(amb, pts, { duration: P, delay: t0 });
    const aura = q('.layer.aura', wrap); if (aura) run(aura, [{ opacity: 0.7 }, { opacity: 1 }], { duration: P * 2, delay: t0, iterations: Infinity, direction: 'alternate', easing: 'ease-in-out', fill: 'both' });
    if (draw) qa('[data-arrive]', fr).forEach((c, i) => run(c, [{ opacity: 0, transform: `translateY(${dist('rise')})` }, { opacity: 1, transform: 'none' }], { duration: ms('moderate'), delay: 300 + i * 120, easing: ease('enter') }));
  });

  /* ================= 2. Match: the request path snaps onto the ride ================= */
  const match = root => {
    const fr = q('.mapframe[data-match]', root); if (!fr) return;
    const wrap = q('.mapwrap', fr), path = q('.rt.core', wrap), L = path.getTotalLength();
    const a = path.getPointAtLength(0), b = path.getPointAtLength(L);
    [['.snap.a', a], ['.snap.b', b]].forEach(([s, p]) => { const el = q(s, wrap); el.setAttribute('cx', p.x); el.setAttribute('cy', p.y); });
    if (reduced()) return;
    run(q('.pass', wrap), [{ transform: 'translate(-14px,22px) rotate(-3deg)', opacity: 0.5 }, { transform: 'none', opacity: 1 }], { duration: 520, delay: 700, easing: ease('magnet') });
    qa('.snap', wrap).forEach(el => { el.style.transformBox = 'fill-box'; el.style.transformOrigin = 'center'; run(el, [{ transform: 'scale(.6)', opacity: 0.9 }, { transform: 'scale(2.4)', opacity: 0 }], { duration: ms('slow') + 100, delay: 1220, easing: ease('standard') }); });
    const sh = q('.shared', wrap); if (sh) run(sh, [{ opacity: 0 }, { opacity: 1 }], { duration: ms('moderate'), delay: 1260, easing: ease('standard') });
    const fitc = q('.fit', fr); if (fitc) run(fitc, [{ opacity: 0, transform: `translateY(${dist('rise')})` }, { opacity: 1, transform: 'none' }], { duration: ms('slow'), delay: 1300, easing: ease('spring') });
  };

  /* ================= 3. Seat selection: tactile, magnetic springs ================= */
  const seatPress = el => { if (!reduced()) run(el, [{ transform: `scale(${css('--tk-scale-press')})` }, { transform: 'none' }], { duration: ms('instant') + 40, easing: ease('standard') }); };
  const seats = (faces, k, was) => faces.forEach((f, i) => {
    const on = i < k, wasOn = i < was;
    f.classList.toggle('on', on);
    if (reduced()) return;
    if (on && !wasOn) run(f, [{ transform: 'translateY(10px) scale(.9)' }, { transform: 'none' }], { duration: 520, delay: stag(i - was), easing: ease('magnet') });
    else if (!on && wasOn) run(f, [{ transform: 'scale(.94)' }, { transform: 'none' }], { duration: ms('base'), easing: ease('standard') });
  });
  const seatsIn = root => qa('.seatrow', root).forEach(r => { if (!reduced()) qa('.face', r).forEach((f, i) => run(f, [{ opacity: 0, transform: 'translateY(10px) scale(.9)' }, { opacity: 1, transform: 'none' }], { duration: 520, delay: 300 + stag(i), easing: ease('magnet') })); });
  // mouse-only lean toward the pointer (touch has no hover, it only gets the spring)
  const lean = row => {
    row.addEventListener('pointermove', e => {
      if (e.pointerType !== 'mouse' || reduced()) return;
      qa('.mag', row).forEach(m => {
        const r = m.getBoundingClientRect(), dx = e.clientX - (r.left + r.width / 2), dy = e.clientY - (r.top + r.height / 2), d = Math.hypot(dx, dy), pull = d < 120 ? (1 - d / 120) * 7 : 0;
        m.style.setProperty('--mx', d ? (dx / d) * pull + 'px' : '0px'); m.style.setProperty('--my', d ? (dy / d) * pull + 'px' : '0px');
      });
    });
    row.addEventListener('pointerleave', () => qa('.mag', row).forEach(m => { m.style.setProperty('--mx', '0px'); m.style.setProperty('--my', '0px'); }));
  };

  /* ================= 5. Price reveal ================= */
  const rolls = (root, { animate = false } = {}) => qa('[data-roll]', root).forEach(el => {
    rollInit(el, el.dataset.roll);
    if (el.dataset.from) { rollSet(el, el.dataset.from); rollSet(el, el.dataset.roll, { animate: true, delay: 120 }); }
    else rollSet(el, el.dataset.roll, animate ? { from: 0, animate: true, delay: 220 } : {});
  });
  const ringPulse = el => { if (el && !reduced()) run(el, [{ transform: 'scale(1)', opacity: 0.9 }, { transform: 'scale(3.4)', opacity: 0 }], { duration: ms('reveal'), delay: 120, easing: ease('standard') }); };

  /* ================= 6. Live trip: calm ambient light on the street toward the pickup ================= */
  const live = root => qa('.mapframe[data-live]', root).forEach(fr => {
    const wrap = q('.mapwrap', fr), core = q('.rt.core', wrap), fx = q('.fx', wrap); fit(fr);
    const pts = sample(core, 48), still = q('.pl.still', wrap); if (still) still.style.transform = tr(pts[36]);
    watch(wrap);
    if (reduced()) return;
    const P = ms('ambient');
    qa('.pl.t', fx).forEach((t, i) => loop(t, pts, { duration: P, delay: 60 * (i + 1), peak: [0.6, 0.35, 0.18][i] }));
    loop(q('.pl.amb', fx), pts, { duration: P });
    qa('.ring-wait', wrap).forEach(r => run(r, [{ transform: 'scale(1)', opacity: 0.8 }, { transform: 'scale(2.6)', opacity: 0 }], { duration: P / 2, iterations: Infinity, easing: ease('standard'), fill: 'both' }));
  });

  /* ================= 7. The Haide moment: the main action leaves ================= */
  const launch = (btn, { haide = true, ok } = {}) => new Promise(res => {
    const done = () => res();
    btn.classList.add('is-done'); btn.setAttribute('aria-disabled', 'true');
    if (ok) btn.setAttribute('aria-label', ok);
    if (reduced()) return setTimeout(done, 350);
    if (navigator.vibrate) navigator.vibrate(12); // optional haptic where supported, never with reduced motion
    const W = btn.clientWidth, dep = ease('departure');
    run(btn, [{ transform: `scale(${css('--tk-scale-press')})` }, { transform: 'none' }], { duration: ms('instant') + 60, easing: ease('standard') });
    run(q('.l1', btn), [{ opacity: 1, transform: 'none' }, { opacity: 0, transform: 'translateX(-12px)' }], { duration: ms('fast') + 40, delay: 60, easing: ease('exit'), fill: 'both' });
    run(q('.dotl', btn), [{ opacity: 1, transform: 'translateX(0)' }, { opacity: 1, transform: `translateX(${W + 8}px)` }], { duration: 380, delay: 100, easing: dep });
    run(q('.wipe', btn), [{ transform: 'scaleX(0)' }, { transform: 'scaleX(1)' }], { duration: 380, delay: 140, easing: dep });
    const hw = q('.l3', btn);
    if (haide && hw) run(hw, [{ opacity: 0, transform: 'translateY(8px)' }, { opacity: 1, transform: 'none', offset: 0.3 }, { opacity: 1, transform: 'none', offset: 0.72 }, { opacity: 0, transform: 'translateY(-6px)' }], { duration: 400, delay: 500, easing: ease('standard'), fill: 'none' });
    run(q('.l2', btn), [{ opacity: 0, transform: `translateY(${dist('rise')})` }, { opacity: 1, transform: 'none' }], { duration: ms('slow'), delay: haide ? 840 : 540, easing: ease('spring') });
    const ring = q('.cta-ring', btn.parentElement); if (ring) run(ring, [{ opacity: 0.9, transform: 'scale(1)' }, { opacity: 0, transform: 'scale(1.1,1.5)' }], { duration: ms('slow') + 100, delay: 520, easing: ease('standard'), fill: 'none' });
    setTimeout(done, haide ? 1050 : 850);
  });

  /* ================= 8. Loading and empty: a small light on a tiny route, no spinners ================= */
  const ambient = root => qa('.ld,.empty-art', root).forEach(svg => {
    const wrap = svg.closest('.ambient') || svg; watch(wrap);
    const path = q('.tr', svg), still = q('.still', svg), pts = sample(path, 40);
    if (still) still.style.transform = tr(pts[20]);
    if (reduced()) return;
    if (svg.classList.contains('ld')) {
      loop(q('.hd', svg), pts, { duration: ms('pulse') * 0.75 });
      qa('.tl', svg).forEach((t, i) => loop(t, pts, { duration: ms('pulse') * 0.75, delay: 60 * (i + 1), peak: [0.6, 0.35, 0.18][i] }));
    } else {
      const dot = q('.breath', svg); dot.style.transformBox = 'fill-box'; dot.style.transformOrigin = 'center';
      run(dot, [{ transform: 'scale(1)' }, { transform: 'scale(1.35)' }, { transform: 'scale(1)' }], { duration: 4000, iterations: Infinity, easing: ease('standard'), fill: 'both' });
    }
  });

  /* ================= generic entrance: rise + fade, staggered ================= */
  const enter = (root, delay = 0) => { if (!reduced()) qa('[data-enter]', root).slice(0, 8).forEach((el, i) => run(el, [{ opacity: 0, transform: `translateY(${dist('rise')})` }, { opacity: 1, transform: 'none' }], { duration: ms('moderate'), delay: delay + stag(i), easing: ease('enter') })); };

  /* ================= 4. Shared-element transition (View Transitions API), instant without support ================= */
  const transition = update => {
    if (!document.startViewTransition || reduced()) { update(); return Promise.resolve(); }
    const vt = document.startViewTransition(update);
    vt.finished.catch(() => {});
    return vt.updateCallbackDone.catch(() => {});
  };

  const setReduced = on => { R.dataset.motion = on ? 'reduced' : 'full'; if (on) document.getAnimations().forEach(a => a.cancel()); };
  return { reduced, setReduced, run, stop, sample, tr, loop, rollInit, rollSet, rolls, ringPulse, fit, maps, match, seats, seatsIn, seatPress, lean, live, launch, ambient, enter, transition, unwatch, watch, ms, ease };
})();
