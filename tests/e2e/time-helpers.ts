import { expect, type Page } from '@playwright/test';

/**
 * Drives the alarm-style TimePicker: opens the sheet from the field called `label`, types the hour and the minute into
 * the two wheels (type-ahead, exactly what a keyboard user does) and presses "Set time". `hhmm` is 'HH:MM' with the
 * minute on the 5 minute grid.
 */
export async function pickTime(page: Page, label: string, hhmm: string): Promise<void> {
  const [hh, mm] = hhmm.split(':') as [string, string];
  await page.getByRole('button', { name: new RegExp(`^${label}`) }).click();
  const sheet = page.getByRole('dialog', { name: label, exact: true });
  await expect(sheet).toBeVisible();
  const hoursBox = sheet.getByRole('listbox', { name: 'Hours' });
  const minutesBox = sheet.getByRole('listbox', { name: 'Minutes' });
  await hoursBox.focus();
  await page.keyboard.type(hh);
  await expect(hoursBox.getByRole('option', { name: hh, exact: true })).toHaveAttribute(
    'aria-selected',
    'true',
  );
  await minutesBox.focus();
  await page.keyboard.type(mm);
  await expect(minutesBox.getByRole('option', { name: mm, exact: true })).toHaveAttribute(
    'aria-selected',
    'true',
  );
  await sheet.getByRole('button', { name: 'Set time' }).click();
  await expect(sheet).toBeHidden();
}

/**
 * Drives the DayPicker: opens the sheet from the field called `label` ('Day', 'Until') and taps the row. `target` is the
 * row text ('Tomorrow', 'Mon 24 Nov') or a 'YYYY-MM-DD' value.
 */
export async function pickDay(page: Page, label: string, target: string): Promise<void> {
  await page.getByRole('button', { name: new RegExp(`^${label}`) }).click();
  const sheet = page.getByRole('dialog', { name: label, exact: true });
  await expect(sheet).toBeVisible();
  const wheel = sheet.getByRole('listbox', { name: 'Day' });
  const row = /^\d{4}-\d{2}-\d{2}$/.test(target)
    ? wheel.locator(`[data-value="${target}"]`)
    : wheel.getByRole('option', { name: target, exact: true });
  await row.click();
  await expect(row).toHaveAttribute('aria-selected', 'true');
  await sheet.getByRole('button', { name: 'Set day' }).click();
  await expect(sheet).toBeHidden();
}
