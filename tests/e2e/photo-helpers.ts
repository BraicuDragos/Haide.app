import type { Page } from '@playwright/test';

/**
 * A real, decodable test photo (the 1x1 fixture is below the cropper's 200 px minimum): a gradient with a marker
 * square, drawn in the page so no image library is needed.
 */
export async function makeImage(
  page: Page,
  width = 800,
  height = 600,
  mimeType: 'image/png' | 'image/jpeg' = 'image/jpeg',
): Promise<{ name: string; mimeType: string; buffer: Buffer }> {
  const dataUrl = await page.evaluate(
    ({ width, height, mimeType }) => {
      const c = document.createElement('canvas');
      c.width = width;
      c.height = height;
      const ctx = c.getContext('2d')!;
      const g = ctx.createLinearGradient(0, 0, width, height);
      g.addColorStop(0, 'orange');
      g.addColorStop(1, 'navy');
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, width, height);
      ctx.fillStyle = 'white';
      ctx.fillRect(width / 2 - 40, height / 2 - 40, 80, 80);
      return c.toDataURL(mimeType, 0.9);
    },
    { width, height, mimeType },
  );
  return {
    name: mimeType === 'image/png' ? 'me.png' : 'me.jpg',
    mimeType,
    buffer: Buffer.from(dataUrl.split(',')[1]!, 'base64'),
  };
}
