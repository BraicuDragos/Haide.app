import { DomainError } from './errors.ts';
import { PHOTO_MAX_BYTES, PHOTO_MAX_PIXELS } from './rules.ts';

/** Pure upload checks for avatars: magic bytes, size, declared dimensions. No decoding here. */

export type ImageKind = 'jpeg' | 'png';

const PNG_MAGIC = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

/** Detects the format from magic bytes (never from the filename or the declared MIME type). */
export function detectImageKind(b: Uint8Array): ImageKind | null {
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'jpeg';
  if (b.length >= 8 && PNG_MAGIC.every((v, i) => b[i] === v)) return 'png';
  return null;
}

/** Pixel dimensions read from the header (PNG IHDR, JPEG SOFn). Null when unreadable. */
export function readImageSize(
  b: Uint8Array,
  kind: ImageKind,
): { width: number; height: number } | null {
  if (kind === 'png') {
    if (b.length < 24) return null;
    const dv = new DataView(b.buffer, b.byteOffset, b.byteLength);
    return { width: dv.getUint32(16), height: dv.getUint32(20) };
  }
  let i = 2;
  while (i + 9 < b.length) {
    if (b[i] !== 0xff) return null;
    const marker = b[i + 1] ?? 0;
    if (marker === 0xff) {
      i += 1; // fill byte
      continue;
    }
    const len = ((b[i + 2] ?? 0) << 8) | (b[i + 3] ?? 0);
    // SOF0..SOF15 except DHT (c4), JPG (c8) and DAC (cc)
    const isSof =
      marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc;
    if (isSof) {
      return {
        height: ((b[i + 5] ?? 0) << 8) | (b[i + 6] ?? 0),
        width: ((b[i + 7] ?? 0) << 8) | (b[i + 8] ?? 0),
      };
    }
    if (len < 2) return null;
    i += 2 + len;
  }
  return null;
}

/**
 * Validates an upload before decoding: size, magic bytes, sane dimensions.
 * PHOTO_TOO_LARGE above 1.5 MiB, PHOTO_INVALID for anything that is not a decodable JPEG/PNG.
 */
export function checkPhotoUpload(bytes: Uint8Array): ImageKind {
  if (bytes.length > PHOTO_MAX_BYTES) {
    throw new DomainError('PHOTO_TOO_LARGE', 'Photo is larger than 1.5 MB.');
  }
  const kind = detectImageKind(bytes);
  if (!kind) throw new DomainError('PHOTO_INVALID', 'Photo must be a JPEG or PNG image.');
  const size = readImageSize(bytes, kind);
  if (!size || size.width < 1 || size.height < 1) {
    throw new DomainError('PHOTO_INVALID', 'Photo dimensions cannot be read.');
  }
  if (size.width * size.height > PHOTO_MAX_PIXELS) {
    throw new DomainError('PHOTO_INVALID', 'Photo has too many pixels.');
  }
  return kind;
}
