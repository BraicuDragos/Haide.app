import { describe, expect, it } from 'vitest';
import { fakeJpeg, fakePng } from '../testing.ts';
import type { DomainError } from './errors.ts';
import { checkPhotoUpload, detectImageKind, readImageSize } from './photo.ts';
import { PHOTO_MAX_BYTES } from './rules.ts';

const code = (fn: () => unknown) => {
  try {
    fn();
  } catch (e) {
    return (e as DomainError).code;
  }
  return null;
};

describe('detectImageKind', () => {
  it('recognises JPEG and PNG by magic bytes only', () => {
    expect(detectImageKind(fakeJpeg(10, 10))).toBe('jpeg');
    expect(detectImageKind(fakePng(10, 10))).toBe('png');
  });
  it.each([
    ['GIF', [0x47, 0x49, 0x46, 0x38, 0x39, 0x61, 0, 0]],
    ['WebP', [0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50]],
    ['PDF', [0x25, 0x50, 0x44, 0x46, 0x2d]],
    ['HTML', [0x3c, 0x68, 0x74, 0x6d, 0x6c, 0x3e]],
    ['empty', []],
  ])('rejects %s', (_n, bytes) => expect(detectImageKind(Uint8Array.from(bytes))).toBeNull());
});

describe('readImageSize', () => {
  it('reads PNG IHDR and JPEG SOF0 dimensions', () => {
    expect(readImageSize(fakePng(800, 600), 'png')).toEqual({ width: 800, height: 600 });
    expect(readImageSize(fakeJpeg(1024, 768), 'jpeg')).toEqual({ width: 1024, height: 768 });
  });
  it('returns null for truncated data', () => {
    expect(readImageSize(Uint8Array.from([0xff, 0xd8, 0xff]), 'jpeg')).toBeNull();
    expect(readImageSize(fakePng(1, 1).slice(0, 10), 'png')).toBeNull();
  });
});

describe('checkPhotoUpload', () => {
  it('accepts a normal JPEG and PNG', () => {
    expect(checkPhotoUpload(fakeJpeg(1024, 1024))).toBe('jpeg');
    expect(checkPhotoUpload(fakePng(512, 512))).toBe('png');
  });
  it('rejects files over 1.5 MB with PHOTO_TOO_LARGE', () => {
    expect(code(() => checkPhotoUpload(new Uint8Array(PHOTO_MAX_BYTES + 1)))).toBe(
      'PHOTO_TOO_LARGE',
    );
  });
  it('accepts exactly 1.5 MB of valid JPEG', () => {
    const pad = new Uint8Array(PHOTO_MAX_BYTES);
    pad.set(fakeJpeg(100, 100));
    expect(checkPhotoUpload(pad)).toBe('jpeg');
  });
  it('rejects non-images and unreadable headers with PHOTO_INVALID', () => {
    const html = new TextEncoder().encode('<html>hi</html>');
    expect(code(() => checkPhotoUpload(html))).toBe('PHOTO_INVALID');
    expect(code(() => checkPhotoUpload(Uint8Array.from([0xff, 0xd8, 0xff, 0xd9])))).toBe(
      'PHOTO_INVALID',
    );
  });
  it('rejects decompression bombs and zero-sized images', () => {
    expect(code(() => checkPhotoUpload(fakePng(20000, 20000)))).toBe('PHOTO_INVALID');
    expect(code(() => checkPhotoUpload(fakePng(0, 100)))).toBe('PHOTO_INVALID');
  });
});
