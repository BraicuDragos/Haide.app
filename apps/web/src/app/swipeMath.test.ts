import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  SWIPE,
  commitDistance,
  decideIntent,
  directionOf,
  dragOffset,
  inStartZone,
  shouldCommit,
  targetIndex,
} from './swipeMath';

describe('inStartZone', () => {
  it('ignores the outer edge bands', () => {
    expect(inStartZone(0, 360)).toBe(false);
    expect(inStartZone(23, 360)).toBe(false);
    expect(inStartZone(24, 360)).toBe(true);
    expect(inStartZone(336, 360)).toBe(true);
    expect(inStartZone(337, 360)).toBe(false);
    expect(inStartZone(360, 360)).toBe(false);
  });
});

describe('decideIntent', () => {
  it('waits for the first 10 px', () => {
    expect(decideIntent(9, 0)).toBe('pending');
    expect(decideIntent(-6, 7)).toBe('pending');
  });
  it('is horizontal only when clearly sideways', () => {
    expect(decideIntent(17, 10)).toBe('horizontal');
    expect(decideIntent(-17, 10)).toBe('horizontal');
    expect(decideIntent(16, 10)).toBe('cancel');
    expect(decideIntent(2, 12)).toBe('cancel');
  });
});

describe('shouldCommit', () => {
  it('needs 64 px (or 18% of a wide screen)', () => {
    expect(commitDistance(360)).toBeCloseTo(64.8);
    expect(commitDistance(300)).toBe(64);
    expect(commitDistance(600)).toBeCloseTo(108);
    expect(shouldCommit(-64, 0, 400, 360)).toBe(false);
    expect(shouldCommit(-65, 0, 400, 360)).toBe(true);
    expect(shouldCommit(-80, 0, 400, 600)).toBe(false);
  });
  it('accepts a fling of at least 32 px at 0.45 px/ms', () => {
    expect(shouldCommit(-40, 0, 80, 360)).toBe(true); // 0.5 px/ms
    expect(shouldCommit(-40, 0, 100, 360)).toBe(false); // 0.4 px/ms
    expect(shouldCommit(-31, 0, 10, 360)).toBe(false); // fast but too short
  });
  it('rejects a finish that turned mostly vertical', () => {
    expect(shouldCommit(-70, 60, 300, 360)).toBe(false);
  });
});

describe('direction mapping and ends', () => {
  it('left is next, right is previous', () => {
    expect(directionOf(-50)).toBe('next');
    expect(directionOf(50)).toBe('prev');
  });
  it('stops at the ends, no wrap', () => {
    expect(targetIndex(0, 4, 'prev')).toBeNull();
    expect(targetIndex(0, 4, 'next')).toBe(1);
    expect(targetIndex(3, 4, 'next')).toBeNull();
    expect(targetIndex(3, 4, 'prev')).toBe(2);
    expect(targetIndex(-1, 4, 'next')).toBeNull();
  });
});

describe('dragOffset', () => {
  it('is capped, resisted and weaker at the ends', () => {
    expect(dragOffset(40, true)).toBeCloseTo(14);
    expect(dragOffset(500, true)).toBe(SWIPE.dragMaxPx);
    expect(dragOffset(-500, true)).toBe(-SWIPE.dragMaxPx);
    expect(Math.abs(dragOffset(500, false))).toBeLessThan(SWIPE.dragMaxPx);
  });
});

describe('properties', () => {
  const coord = fc.integer({ min: -600, max: 600 });
  it('a mostly vertical move never commits and never decides horizontal', () => {
    fc.assert(
      fc.property(coord, coord, fc.integer({ min: 1, max: 2000 }), (dx, dy, dt) => {
        fc.pre(Math.abs(dx) < SWIPE.intentRatio * Math.abs(dy));
        expect(shouldCommit(dx, dy, dt, 360)).toBe(false);
        expect(decideIntent(dx, dy)).not.toBe('horizontal');
      }),
    );
  });
  it('a direction and a target are never both: one sign, one neighbour', () => {
    fc.assert(
      fc.property(
        coord.filter((v) => v !== 0),
        fc.integer({ min: 0, max: 3 }),
        (dx, i) => {
          const dir = directionOf(dx);
          const to = targetIndex(i, 4, dir);
          if (to !== null) expect(to - i).toBe(dir === 'next' ? 1 : -1);
          expect(directionOf(-dx)).not.toBe(dir);
        },
      ),
    );
  });
});
