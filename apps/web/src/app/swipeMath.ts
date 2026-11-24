/**
 * Pure maths for swiping between the four root tabs. All tuning lives in SWIPE so it is easy to adjust after a
 * real-phone try. No DOM here: the hook (useTabSwipe) feeds in numbers.
 */
export const SWIPE = {
  /** Travel (px) after which the gesture's intent is decided: horizontal swipe or something else. */
  intentPx: 10,
  /** Horizontal wins only when |dx| >= ratio * |dy|. Anything steeper is a scroll and is never touched. */
  intentRatio: 1.7,
  /** Commit when horizontal travel reaches max(minTravelPx, travelFraction * width). */
  minTravelPx: 64,
  travelFraction: 0.18,
  /** Or a fling: at least flingVelocity px/ms over at least flingMinPx. */
  flingVelocity: 0.45,
  flingMinPx: 32,
  /** Gestures starting this close to a screen edge belong to the system (Android back, iOS edge swipe). */
  edgePx: 24,
  /** The screen follows the finger by at most this many px while dragging. */
  dragMaxPx: 24,
  /** The screen moves this fraction of the finger travel (resistance). */
  dragResistance: 0.35,
} as const;

export type Intent = 'pending' | 'horizontal' | 'cancel';
export type Direction = 'next' | 'prev';

/** Start zone: false in the outer edge bands. */
export function inStartZone(x: number, width: number): boolean {
  return x >= SWIPE.edgePx && x <= width - SWIPE.edgePx;
}

/** Decide once the finger has moved intentPx. Before that: pending. Horizontal only when clearly sideways. */
export function decideIntent(dx: number, dy: number): Intent {
  const ax = Math.abs(dx);
  const ay = Math.abs(dy);
  if (Math.max(ax, ay) < SWIPE.intentPx) return 'pending';
  return ax >= SWIPE.intentRatio * ay ? 'horizontal' : 'cancel';
}

/** Distance needed to commit on a screen of this width. */
export const commitDistance = (width: number): number =>
  Math.max(SWIPE.minTravelPx, SWIPE.travelFraction * width);

/** Did the finished gesture commit? Must still be mostly horizontal at the end, not only in the first 10 px. */
export function shouldCommit(dx: number, dy: number, dtMs: number, width: number): boolean {
  const ax = Math.abs(dx);
  if (ax < SWIPE.intentRatio * Math.abs(dy)) return false;
  if (ax >= commitDistance(width)) return true;
  return dtMs > 0 && ax >= SWIPE.flingMinPx && ax / dtMs >= SWIPE.flingVelocity;
}

/** Swiping left (negative dx) goes to the next tab, right to the previous one. */
export const directionOf = (dx: number): Direction => (dx < 0 ? 'next' : 'prev');

/** Neighbouring tab index, or null at the ends (no wrap) or for an unknown current tab. */
export function targetIndex(index: number, count: number, dir: Direction): number | null {
  const next = dir === 'next' ? index + 1 : index - 1;
  return index < 0 || next < 0 || next >= count ? null : next;
}

/** Visual follow: the screen trails the finger with resistance, capped at dragMaxPx; a third of that at the ends. */
export function dragOffset(dx: number, hasNeighbour: boolean): number {
  const raw = dx * SWIPE.dragResistance;
  const capped = Math.max(-SWIPE.dragMaxPx, Math.min(SWIPE.dragMaxPx, raw));
  return hasNeighbour ? capped : capped / 3;
}
