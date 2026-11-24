/** Pure maths of the alarm-style wheels (ui/WheelPicker.tsx): kept apart so it is unit-testable without a DOM. */

/** Height of one wheel row in px. The CSS (`.wheel-item`) uses the same 48. */
export const WHEEL_ITEM_H = 48;

export interface WheelItem {
  value: string;
  label: string;
  disabled?: boolean;
}

const enabled = (items: WheelItem[], i: number) =>
  i >= 0 && i < items.length && !items[i]!.disabled;

/** The row that sits under the centre band for a scroll offset (rows snap to multiples of the row height). */
export function indexFromScroll(scrollTop: number, count: number, rowH = WHEEL_ITEM_H): number {
  if (count <= 0) return 0;
  return Math.min(count - 1, Math.max(0, Math.round(scrollTop / rowH)));
}

/** Scroll offset that puts row `index` under the centre band. */
export const scrollForIndex = (index: number, rowH = WHEEL_ITEM_H): number => index * rowH;

/**
 * Nearest enabled row to `index`. A tie goes to the later row: past times are the disabled ones, so "later" is the
 * safe side. -1 when every row is disabled.
 */
export function nearestEnabled(items: WheelItem[], index: number): number {
  const at = Math.min(items.length - 1, Math.max(0, index));
  for (let d = 0; d < items.length; d++) {
    if (enabled(items, at + d)) return at + d;
    if (enabled(items, at - d)) return at - d;
  }
  return -1;
}

/** Move `steps` enabled rows from `index` (negative: up). Stops at the last enabled row instead of wrapping. */
export function stepEnabled(items: WheelItem[], index: number, steps: number): number {
  const dir = steps < 0 ? -1 : 1;
  let at = index;
  for (let left = Math.abs(steps); left > 0; left--) {
    let next = at + dir;
    while (next >= 0 && next < items.length && !enabled(items, next)) next += dir;
    if (next < 0 || next >= items.length) break;
    at = next;
  }
  return at;
}

export const firstEnabled = (items: WheelItem[]): number => items.findIndex((i) => !i.disabled);

export function lastEnabled(items: WheelItem[]): number {
  for (let i = items.length - 1; i >= 0; i--) if (!items[i]!.disabled) return i;
  return -1;
}

/** Type-ahead: the first enabled row whose label starts with what was typed ("07" -> hour 07, "tom" -> Tomorrow). */
export function typeAheadMatch(items: WheelItem[], typed: string): number {
  const q = typed.toLowerCase();
  if (!q) return -1;
  return items.findIndex((i) => !i.disabled && i.label.toLowerCase().startsWith(q));
}

/** Index of the slot on a `step` grid closest to `minute` (07:32 on a 5 min grid -> the :30 slot). */
export function nearestSlotIndex(minute: number, step: number, slots: number): number {
  return Math.min(slots - 1, Math.max(0, Math.round(minute / step)));
}
