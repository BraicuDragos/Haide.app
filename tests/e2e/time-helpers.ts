import { expect, type Page } from '@playwright/test';

/**
 * Drives the custom TimePicker: opens the sheet from the field called `label`, taps the hour and the minute, confirms.
 * `hhmm` is 'HH:MM' with the minute on the 5 minute grid.
 */
export async function pickTime(page: Page, label: string, hhmm: string): Promise<void> {
  const [hh, mm] = hhmm.split(':') as [string, string];
  await page.getByRole('button', { name: label }).click();
  const sheet = page.getByRole('dialog');
  await sheet
    .getByRole('radiogroup', { name: 'Hour' })
    .getByRole('radio', { name: hh, exact: true })
    .click();
  await sheet
    .getByRole('radiogroup', { name: 'Minute' })
    .getByRole('radio', { name: mm, exact: true })
    .click();
  await sheet.getByRole('button', { name: 'Set time' }).click();
  await expect(sheet).toBeHidden();
}
