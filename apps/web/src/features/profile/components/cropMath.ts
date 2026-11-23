/**
 * Pure maths of the square photo cropper. The crop is a square window on the decoded image: `zoom` 1 shows the
 * largest square (the short side), higher zoom shows a smaller part. `cx`/`cy` are the window centre in source pixels.
 */
export const MIN_ZOOM = 1;
export const MAX_ZOOM = 4;

export interface CropState {
  zoom: number;
  cx: number;
  cy: number;
}
export interface CropRect {
  sx: number;
  sy: number;
  side: number;
}

const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));

export function clampZoom(z: number): number {
  return Number.isFinite(z) ? clamp(z, MIN_ZOOM, MAX_ZOOM) : MIN_ZOOM;
}

/** Side of the source square that is visible at this zoom. */
export function cropSide(iw: number, ih: number, zoom: number): number {
  return Math.min(iw, ih) / clampZoom(zoom);
}

/** Keeps the window inside the image. */
export function clampState(s: CropState, iw: number, ih: number): CropState {
  const zoom = clampZoom(s.zoom);
  const half = cropSide(iw, ih, zoom) / 2;
  return { zoom, cx: clamp(s.cx, half, iw - half), cy: clamp(s.cy, half, ih - half) };
}

export function initialState(iw: number, ih: number): CropState {
  return { zoom: MIN_ZOOM, cx: iw / 2, cy: ih / 2 };
}

/** Source rectangle to draw into the output (always square, always inside the image). */
export function cropRect(s: CropState, iw: number, ih: number): CropRect {
  const c = clampState(s, iw, ih);
  const side = cropSide(iw, ih, c.zoom);
  return { sx: c.cx - side / 2, sy: c.cy - side / 2, side };
}

/** Dragging the photo by (dx, dy) screen pixels in a square viewport of `view` px moves the window the other way. */
export function panBy(
  s: CropState,
  dx: number,
  dy: number,
  view: number,
  iw: number,
  ih: number,
): CropState {
  const perPx = cropSide(iw, ih, s.zoom) / view;
  return clampState({ ...s, cx: s.cx - dx * perPx, cy: s.cy - dy * perPx }, iw, ih);
}

/** Zoom about the window centre; the window is re-clamped. */
export function zoomTo(s: CropState, zoom: number, iw: number, ih: number): CropState {
  return clampState({ ...s, zoom }, iw, ih);
}
