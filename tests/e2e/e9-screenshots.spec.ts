import { test } from '@playwright/test';
import { mockAccountApi, seedSession } from './accounts-helpers';
import { makeImage } from './photo-helpers';
import { mockPlaces, readyDriver } from './rides-helpers';

// Screenshots for the PR: hero road, time picker, photo crop. Output: docs/screenshots/improvements/.
const OUT = 'docs/screenshots/improvements';

test('hero road at phone and desktop width', async ({ page }) => {
  await mockPlaces(page);
  for (const vp of [
    { width: 360, height: 800 },
    { width: 1280, height: 800 },
  ]) {
    await page.setViewportSize(vp);
    await page.goto('/find');
    await page.waitForTimeout(3000);
    await page.screenshot({ path: `${OUT}/hero-${vp.width}.jpg`, type: 'jpeg', quality: 82 });
  }
});

test('time picker sheet', async ({ page }) => {
  await mockPlaces(page);
  await page.goto('/find');
  await page.getByRole('button', { name: /^Leave around/ }).click();
  await page.getByRole('dialog').locator('[role=radio]:not([disabled])').first().click();
  await page.waitForTimeout(600);
  await page.screenshot({ path: `${OUT}/time-picker.jpg`, type: 'jpeg', quality: 82 });
});

test('photo crop dialog', async ({ page }) => {
  await seedSession(page);
  await mockAccountApi(page, readyDriver());
  await page.goto('/profile/edit');
  await page
    .locator('input[type=file]')
    .setInputFiles(await makeImage(page, 1600, 1000, 'image/jpeg'));
  await page.getByRole('slider', { name: 'Zoom' }).fill('1.6');
  await page.waitForTimeout(700);
  await page.screenshot({ path: `${OUT}/photo-crop.jpg`, type: 'jpeg', quality: 82 });
});
