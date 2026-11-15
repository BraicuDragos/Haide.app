# 0019. Motion: no JS animation library; CSS, Web Animations API, View Transitions and linear() springs

- **Status:** Accepted
- **Date:** 2026-11-15
- **Area:** Architecture
- **Agent:** brand-designer

## Context
The "Headlight" direction needs eight signature moments (route draw-in with a travelling light, match, seat springs, shared-element transitions, price reveal, live trip, the launch moment, branded loading) at 60 fps on a mid-range phone. The initial JS is about 155 KB gzip against a 200 KB budget, so motion may add about 25 KB gzip at most. The brief says to prefer CSS, WAAPI and View Transitions and to justify any library in an ADR. We built the moments as working demos (`docs/brand/preview-motion.html`) to find out whether a library is needed.

## Options considered
| Option | Pros | Cons | Cost / effort |
|---|---|---|---|
| A. **No library**: CSS transitions, WAAPI `element.animate`, View Transitions API, `linear()` easing for springs, about 1 KB gzip of helpers | 0 added dependencies. Transform and opacity run on the compositor. Springs via `linear()` (Chrome 113, Firefox 112, Safari 17.2) with a cubic-bezier fallback. Frame-exact recording and a clean reduced-motion story (base CSS is the final state, animate only when allowed) | We write about 60 lines of helpers (path sampling, ambient loop, digit roll). Interruptible, velocity-aware springs are not available (our moments do not need them) | Low |
| B. Motion (`motion` package: mini about 2 to 3 KB, hybrid about 18 KB) [A, sizes from memory] | Nice API, springs with velocity, gestures | The extra KB buy features we do not use. A second way to animate | Low |
| C. GSAP (about 23 KB gzip) [A] or Lottie (about 60 KB or more) [A] | Timelines, SVG plugins, designer pipeline | Would consume the whole motion budget. Lottie files are opaque and hard to keep consistent with tokens | Medium |

## Decision
**Option A. No JS animation library.** Rules:
1. Animate **transform and opacity only**. Single exception: the one-shot route draw-in animates `stroke-dashoffset` on a small SVG, once per route, about 900 ms.
2. The travelling light is an HTML element moved with `transform: translate()` keyframes sampled from the SVG path (`getPointAtLength`, 48 to 64 points), so it stays on the compositor. The glow is stacked wide strokes, never an animated blur or filter.
3. Shared easings and durations come from `design-tokens.json` (`motion.duration`, `motion.easing`: standard, enter, exit, momentum, departure, linear, spring, magnet). Springs are `linear()` curves generated from damped-spring maths (spring: damping ratio 0.62, 8% overshoot; magnet: 0.45, 20%) with `spring-fallback` and `magnet-fallback` cubic-beziers. `tokens.ts` emits the fallback by default and the `linear()` value inside `@supports`.
4. The base CSS is always the calm final state. Reduced motion (OS setting or in-app switch) means: do not start the animation. Infinite loops are paused when off screen.
5. Shared-element transitions use `document.startViewTransition` where available (Chrome 111, Safari 18, Firefox 144), with `view-transition-name` on the route line and the price. Without support, navigation is instant.
6. Backdrop blur on at most two layers per screen, with `@supports` and `prefers-reduced-transparency` fallbacks. Grain is one static tile.
7. Haptics: `navigator.vibrate(12)` only on the launch moment, only where supported, never when reduced motion is on.

Measured: the demo helpers are about 2.7 KB raw (about 1.3 KB gzip before minification, under 1 KB minified). Component CSS for the demos is about 4 KB gzip. Even with the per-screen orchestration code the estimate is **5 to 10 KB gzip**, well under 25 KB.

## Consequences
- Positive: no new dependency, tiny budget use, motion is token-driven and testable (the recorder steps `currentTime`, so recordings are exact).
- Negative / accepted risks: older browsers without `linear()` get a plain overshoot curve. No gesture-driven or interrupt-with-velocity animations (we have no drag interactions). Contributors must follow rule 1 by hand; qa-reviewer checks it.
- What would trigger revisiting: a moment that needs drag with inertia, or helpers growing beyond about 5 KB gzip.

## Sources
- [View Transitions, same-document: browser support](https://web.dev/blog/same-document-view-transitions-are-now-baseline-newly-available)
- [CSS linear() easing, Chrome docs](https://developer.chrome.com/docs/css-ui/css-linear-easing-function) and [Baseline entry](https://web-platform-dx.github.io/web-features-explorer/features/linear-easing)
- `docs/brand/preview-motion.html`, `docs/brand/tools/record-motion.mjs`
