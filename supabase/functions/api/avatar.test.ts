import { Image } from 'imagescript';
import { describe, expect, it } from 'vitest';
import { checkPhotoUpload, detectImageKind, readImageSize } from '../_shared/domain/photo.ts';
import { encodeAvatar } from './services/avatar.ts';

/** Splices an APP1/Exif segment carrying fake GPS data right after the SOI marker of a JPEG. */
function withGpsExif(jpeg: Uint8Array): Uint8Array {
  const payload = new TextEncoder().encode(
    'Exif\0\0MM\0*GPSLatitudeRef=N;GPSLatitude=45.7972;GPSLongitude=24.1521;SECRET-EXIF-MARKER',
  );
  const len = payload.length + 2;
  const segment = Uint8Array.from([0xff, 0xe1, len >> 8, len & 0xff, ...payload]);
  const out = new Uint8Array(jpeg.length + segment.length);
  out.set(jpeg.subarray(0, 2), 0); // SOI
  out.set(segment, 2);
  out.set(jpeg.subarray(2), 2 + segment.length);
  return out;
}

const contains = (haystack: Uint8Array, needle: string) =>
  Buffer.from(haystack).includes(Buffer.from(needle));

async function makeJpeg(width: number, height: number) {
  const img = new Image(width, height);
  img.fill(Image.rgbToColor(200, 80, 40));
  return await img.encodeJPEG(90);
}

describe('encodeAvatar', () => {
  it('re-encodes to a 512x512 JPEG and drops EXIF/GPS metadata', async () => {
    const original = withGpsExif(await makeJpeg(1024, 768));
    expect(contains(original, 'Exif')).toBe(true);
    expect(contains(original, 'GPSLatitude')).toBe(true);
    expect(checkPhotoUpload(original)).toBe('jpeg'); // the upload checks accept it

    const out = await encodeAvatar(original);
    expect(detectImageKind(out)).toBe('jpeg');
    expect(readImageSize(out, 'jpeg')).toEqual({ width: 512, height: 512 });
    expect(contains(out, 'Exif')).toBe(false);
    expect(contains(out, 'GPS')).toBe(false);
    expect(contains(out, 'SECRET-EXIF-MARKER')).toBe(false);
    // no APP1 (EXIF/XMP) segment right after SOI
    expect(out[2] === 0xff && out[3] === 0xe1).toBe(false);
  });

  it('accepts PNG input and outputs JPEG', async () => {
    const img = new Image(300, 600);
    img.fill(Image.rgbToColor(10, 120, 200));
    const out = await encodeAvatar(await img.encode());
    expect(detectImageKind(out)).toBe('jpeg');
    expect(readImageSize(out, 'jpeg')).toEqual({ width: 512, height: 512 });
  });

  it('upscales small images to 512x512 as well', async () => {
    const out = await encodeAvatar(await makeJpeg(64, 64));
    expect(readImageSize(out, 'jpeg')).toEqual({ width: 512, height: 512 });
  });

  it('rejects bytes that pass the header check but cannot be decoded', async () => {
    const truncated = (await makeJpeg(200, 200)).slice(0, 40);
    await expect(encodeAvatar(truncated)).rejects.toMatchObject({ code: 'PHOTO_INVALID' });
    await expect(encodeAvatar(new TextEncoder().encode('not an image'))).rejects.toMatchObject({
      code: 'PHOTO_INVALID',
    });
  });
});
