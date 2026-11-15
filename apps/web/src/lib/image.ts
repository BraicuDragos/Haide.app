/** Client-side photo preparation (E1 FE 4): decode, shrink to at most 1024 px, re-encode as JPEG. */
export const MAX_SIDE_PX = 1024;
export const MAX_INPUT_BYTES = 5 * 1024 * 1024;
export const MAX_UPLOAD_BYTES = 1.5 * 1024 * 1024; // the API limit after resize
const ACCEPTED = ['image/jpeg', 'image/png', 'image/webp'];

export type PhotoProblem = 'size' | 'invalid';
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
