import { DomainError } from '../../_shared/domain/errors.ts';
import { AVATAR_JPEG_QUALITY, AVATAR_SIZE_PX } from '../../_shared/domain/rules.ts';
import type { AvatarEncoder } from '../types.ts';

/**
 * Decode, centre-crop to a square, resize to 512x512 and re-encode as JPEG. The pixels are the
 * only thing that survives: EXIF (including GPS), ICC profiles and comments are dropped, which is
 * the server-side privacy guarantee (architecture §10). Callers must run checkPhotoUpload first.
 *
 * Jimp (pure JS) is imported lazily so that a load failure in a runtime can only ever break
 * PUT /me/photo, never the boot of the whole API function.
 */
export const encodeAvatar: AvatarEncoder = async (input) => {
  const { Jimp } = await import('jimp');
  let image;
  try {
    image = await Jimp.fromBuffer(input.slice().buffer as ArrayBuffer);
  } catch {
    throw new DomainError('PHOTO_INVALID', 'Photo could not be decoded.');
  }
  image.cover({ w: AVATAR_SIZE_PX, h: AVATAR_SIZE_PX });
  const out = await image.getBuffer('image/jpeg', { quality: AVATAR_JPEG_QUALITY });
  return new Uint8Array(out);
};
