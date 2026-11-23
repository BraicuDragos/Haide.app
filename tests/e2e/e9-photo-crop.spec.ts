import { expect, test, type Page } from '@playwright/test';
import { expectNoAxeViolations, mockAccountApi, seedSession } from './accounts-helpers';
import { readyDriver } from './rides-helpers';
import { makeImage } from './photo-helpers';

// Improvement 2: choosing a profile photo opens a crop dialog; the upload is the cropped square JPEG.
// Real gesture handling on a phone is not covered here (mouse pointer events only).

const MAX_BYTES = 1.5 * 1024 * 1024;

async function openProfile(page: Page) {
  const acc = readyDriver();
  await seedSession(page);
  await mockAccountApi(page, acc);
  await page.goto('/profile/edit');
  await expect(page.getByRole('button', { name: /photo$/i })).toBeVisible();
  return acc;
}

/** Reads the width and height of the JPEG that was uploaded (multipart body), from its SOF marker. */
function jpegSize(body: Buffer): { w: number; h: number } | null {
  const start = body.indexOf(Buffer.from([0xff, 0xd8, 0xff]));
  if (start < 0) return null;
  for (let i = start + 2; i < body.length - 9;) {
    if (body[i] !== 0xff) return null;
    const marker = body[i + 1]!;
    if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc)
      return { h: body.readUInt16BE(i + 5), w: body.readUInt16BE(i + 7) };
    i += 2 + body.readUInt16BE(i + 2);
  }
  return null;
}

test.describe('profile photo crop', () => {
  test('crop, zoom, drag, confirm: uploads a square 512 JPEG within the limit', async ({
    page,
  }) => {
    const acc = await openProfile(page);
    await page
      .locator('input[type=file]')
      .setInputFiles(await makeImage(page, 1600, 1000, 'image/jpeg'));
    const dialog = page.getByRole('dialog', { name: 'Adjust your photo' });
    await expect(dialog).toBeVisible();
    await expectNoAxeViolations(page);

    const area = dialog.getByTestId('crop-area');
    const slider = dialog.getByRole('slider', { name: 'Zoom' });
    await slider.fill('2');
    await dialog.getByRole('button', { name: 'Zoom in' }).click();
    expect(Number(await slider.inputValue())).toBeCloseTo(2.25, 1);

    const b = (await area.boundingBox())!;
    await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2);
    await page.mouse.down();
    await page.mouse.move(b.x + b.width / 2 + 40, b.y + b.height / 2 + 20, { steps: 5 });
    await page.mouse.up();
    await area.focus();
    await page.keyboard.press('ArrowLeft');
    await page.keyboard.press('-');

    await dialog.getByRole('button', { name: 'Use photo' }).click();
    await expect(dialog).toBeHidden();
    await expect(page.getByRole('button', { name: 'Change photo' })).toBeVisible();

    await page.getByRole('button', { name: 'Save changes' }).click();
    await expect.poll(() => acc.upload !== null).toBe(true);
    const body = acc.upload!.bytes;
    expect(body.length).toBeLessThanOrEqual(MAX_BYTES);
    expect(body.includes(Buffer.from('image/jpeg'))).toBe(true);
    expect(jpegSize(body)).toEqual({ w: 512, h: 512 });
  });

  test('cancel keeps the old photo and the same file can be picked again', async ({ page }) => {
    const acc = await openProfile(page);
    const file = await makeImage(page, 900, 900, 'image/png');
    const input = page.locator('input[type=file]');
    await input.setInputFiles(file);
    await page.getByRole('dialog').getByRole('button', { name: 'Cancel' }).click();
    await expect(page.getByRole('dialog')).toBeHidden();
    expect(acc.upload).toBeNull();
    await input.setInputFiles(file); // would not fire change if the input had not been reset
    await expect(page.getByRole('dialog', { name: 'Adjust your photo' })).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog')).toBeHidden();
  });

  test('bad files give a clear message and no dialog', async ({ page }) => {
    await openProfile(page);
    const input = page.locator('input[type=file]');
    await input.setInputFiles({
      name: 'notes.png',
      mimeType: 'image/png',
      buffer: Buffer.from('this is not an image'),
    });
    await expect(
      page.getByText('We couldn’t read this photo. Choose a JPEG or PNG.'),
    ).toBeVisible();
    await expect(page.getByRole('dialog')).toBeHidden();

    await input.setInputFiles(await makeImage(page, 120, 120, 'image/png'));
    await expect(page.getByText('This photo is too small.')).toBeVisible();

    await input.setInputFiles({
      name: 'huge.jpg',
      mimeType: 'image/jpeg',
      buffer: Buffer.alloc(5 * 1024 * 1024 + 1),
    });
    await expect(page.getByText('This photo is over 5 MB.')).toBeVisible();
    await expect(page.getByRole('dialog')).toBeHidden();
  });
});
