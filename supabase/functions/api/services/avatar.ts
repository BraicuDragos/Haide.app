import { Image } from 'imagescript';
import { DomainError } from '../../_shared/domain/errors.ts';
import { AVATAR_JPEG_QUALITY, AVATAR_SIZE_PX } from '../../_shared/domain/rules.ts';
import type { AvatarEncoder } from '../types.ts';

/**
 * Decode, centre-crop to a square, resize to 512x512 and re-encode as JPEG. The pixels are the
 * only thing that survives: EXIF (including GPS), ICC profiles and comments are dropped, which is
 * the server-side privacy guarantee (architecture §10). Callers must run checkPhotoUpload first.
 */
export const encodeAvatar: AvatarEncoder = async (input) => {
  let image: Image;
  try {
    const decoded = await Image.decode(input);
    if (!(decoded instanceof Image)) throw new Error('animated images are not supported');
    image = decoded;
  } catch {
    throw new DomainError('PHOTO_INVALID', 'Photo could not be decoded.');
  }
  image.cover(AVATAR_SIZE_PX, AVATAR_SIZE_PX);
  return await image.encodeJPEG(AVATAR_JPEG_QUALITY);
};
