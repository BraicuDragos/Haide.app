/** Client-side photo preparation (E1 FE 4): decode, shrink to at most 1024 px, re-encode as JPEG. */
export const MAX_SIDE_PX = 1024;
export const MAX_INPUT_BYTES = 5 * 1024 * 1024;
export const MAX_UPLOAD_BYTES = 1.5 * 1024 * 1024; // the API limit after resize
const ACCEPTED = ['image/jpeg', 'image/png', 'image/webp'];

export const MAX_DECODE_SIDE_PX = 2048; // decode cap for the cropper: plenty for a 512 px avatar at 4x zoom
export const MIN_SOURCE_SIDE_PX = 200;
export const AVATAR_OUTPUT_PX = 512; // the server's AVATAR_SIZE_PX
export const AVATAR_QUALITY = 0.85;

export type PhotoProblem = 'size' | 'invalid' | 'small';
export class PhotoError extends Error {
  readonly problem: PhotoProblem;
  constructor(problem: PhotoProblem) {
    super(problem);
    this.name = 'PhotoError';
    this.problem = problem;
  }
}

/** Scales (w, h) down so the longer side is at most `max`. Never scales up. */
export function fitWithin(w: number, h: number, max = MAX_SIDE_PX): { w: number; h: number } {
  const longest = Math.max(w, h);
  if (longest <= max) return { w, h };
  const k = max / longest;
  return { w: Math.max(1, Math.round(w * k)), h: Math.max(1, Math.round(h * k)) };
}

function toBlob(canvas: HTMLCanvasElement, quality: number): Promise<Blob | null> {
  return new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', quality));
}

/**
 * Returns a JPEG blob of at most 1024 px and 1.5 MB. Re-encoding through a canvas also drops EXIF (location);
 * the server strips metadata again. Throws PhotoError('size') over 5 MB and PhotoError('invalid') when it can't be read.
 */
export async function preparePhoto(file: File): Promise<Blob> {
  if (file.size > MAX_INPUT_BYTES) throw new PhotoError('size');
  if (!ACCEPTED.includes(file.type)) throw new PhotoError('invalid');
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
  } catch {
    throw new PhotoError('invalid');
  }
  try {
    const { w, h } = fitWithin(bitmap.width, bitmap.height);
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new PhotoError('invalid');
    ctx.fillStyle = '#fff'; // PNG transparency becomes white instead of black in a JPEG
    ctx.fillRect(0, 0, w, h);
    ctx.drawImage(bitmap, 0, 0, w, h);
    for (const q of [0.85, 0.7, 0.55, 0.4]) {
      const blob = await toBlob(canvas, q);
      if (!blob) throw new PhotoError('invalid');
      if (blob.size <= MAX_UPLOAD_BYTES) return blob;
    }
    throw new PhotoError('size');
  } finally {
    bitmap.close();
  }
}

/**
 * Decodes a picked file for the cropper: EXIF orientation applied, the longest side capped at 2048 px so a 50 MP phone
 * photo does not hold hundreds of MB. Awaiting createImageBitmap decodes off the main thread. Throws PhotoError:
 * 'size' (over 5 MB), 'invalid' (not JPEG/PNG/WebP or unreadable), 'small' (shorter side under 200 px).
 */
export async function decodeForCrop(file: File): Promise<ImageBitmap> {
  if (file.size > MAX_INPUT_BYTES) throw new PhotoError('size');
  if (!ACCEPTED.includes(file.type)) throw new PhotoError('invalid');
  let full: ImageBitmap;
  try {
    full = await createImageBitmap(file, { imageOrientation: 'from-image' });
  } catch {
    throw new PhotoError('invalid');
  }
  if (Math.min(full.width, full.height) < MIN_SOURCE_SIDE_PX) {
    full.close();
    throw new PhotoError('small');
  }
  const { w, h } = fitWithin(full.width, full.height, MAX_DECODE_SIDE_PX);
  if (w === full.width && h === full.height) return full;
  try {
    return await createImageBitmap(full, {
      resizeWidth: w,
      resizeHeight: h,
      resizeQuality: 'high',
    });
  } catch {
    throw new PhotoError('invalid');
  } finally {
    full.close();
  }
}

/**
 * Cuts the square `rect` (source pixels) out of the decoded bitmap into a 512 x 512 JPEG (quality 0.85, falling back
 * to lower qualities if it ever exceeds the 1.5 MB API limit). One resample from the decoded bitmap, so no double loss.
 */
export async function cropToBlob(
  bitmap: ImageBitmap,
  rect: { sx: number; sy: number; side: number },
): Promise<Blob> {
  const canvas = document.createElement('canvas');
  canvas.width = AVATAR_OUTPUT_PX;
  canvas.height = AVATAR_OUTPUT_PX;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new PhotoError('invalid');
  ctx.imageSmoothingQuality = 'high';
  ctx.fillStyle = '#fff'; // PNG transparency becomes white instead of black in a JPEG
  ctx.fillRect(0, 0, AVATAR_OUTPUT_PX, AVATAR_OUTPUT_PX);
  ctx.drawImage(
    bitmap,
    rect.sx,
    rect.sy,
    rect.side,
    rect.side,
    0,
    0,
    AVATAR_OUTPUT_PX,
    AVATAR_OUTPUT_PX,
  );
  for (const q of [AVATAR_QUALITY, 0.7, 0.55, 0.4]) {
    const blob = await toBlob(canvas, q);
    if (!blob) throw new PhotoError('invalid');
    if (blob.size <= MAX_UPLOAD_BYTES) return blob;
  }
  throw new PhotoError('size');
}
