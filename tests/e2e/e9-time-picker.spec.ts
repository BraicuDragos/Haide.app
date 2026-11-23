import { expect, test, type Page } from '@playwright/test';
import { expectNoAxeViolations } from './accounts-helpers';
import { mockPlaces } from './rides-helpers';
import { mockSearchApi, newFakeSearch } from './search-helpers';
import { pickDay, pickTime } from './time-helpers';

// Improvement 3: the custom time picker on Find. The clock is fixed at about 22:00 in Bucharest so "today" has a
// past to grey out. The publish form uses the same component; its flow is covered in e2-rides.spec.ts.

async function setup(page: Page) {
  const todayRo = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Bucharest' }).format(
    new Date(),
  );
  await page.route('**/telemetry/error', (r) => r.fulfill({ status: 204 }));
  await mockPlaces(page);
  await mockSearchApi(page, newFakeSearch());
  await page.clock.setFixedTime(new Date(`${todayRo}T19:30:00Z`));
}

async function pickPlace(page: Page, which: 'From' | 'To', query: string, name: string) {
  await page.getByRole('button', { name: new RegExp(`^${which}`) }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByRole('searchbox').fill(query);
  await expect(dialog.getByRole('heading', { name: /places? found/ })).toBeVisible();
  await dialog.getByRole('listitem').first().getByRole('button').click();
  await expect(dialog).toBeHidden();
  await expect(page.getByRole('button', { name: `${which} ${name}`, exact: true })).toBeVisible();
}

test.describe('time picker on Find', () => {
  test('opens a sheet, greys out the past today, returns HH:MM, axe clean', async ({ page }) => {
    await setup(page);
    await page.goto('/find');
    const field = page.getByRole('button', { name: /^Leave around/ });
    await expect(field).toContainText('Choose');
    await field.click();
    const sheet = page.getByRole('dialog');
    const hours = sheet.getByRole('listbox', { name: 'Hours' });
    const minutes = sheet.getByRole('listbox', { name: 'Minutes' });
    await expect(hours.getByRole('option')).toHaveCount(24);
    await expect(minutes.getByRole('option')).toHaveCount(12);
    await expect(hours.getByRole('option', { name: '07', exact: true })).toHaveAttribute(
      'aria-disabled',
      'true',
    );
    await expect(hours.getByRole('option', { name: '23', exact: true })).not.toHaveAttribute(
      'aria-disabled',
      'true',
    );
    // touch targets
    const box = await hours.getByRole('option', { name: '23', exact: true }).boundingBox();
    expect(box!.height).toBeGreaterThanOrEqual(44);
    await expectNoAxeViolations(page);

    await hours.getByRole('option', { name: '23', exact: true }).click();
    await minutes.getByRole('option', { name: '45', exact: true }).click();
    await sheet.getByRole('button', { name: 'Set time' }).click();
    await expect(sheet).toBeHidden();
    await expect(field).toContainText('23:45');
    await expect(field).toBeFocused();
  });

  test('keyboard: arrows move the wheel, Esc closes and focus returns', async ({ page }) => {
    await setup(page);
    await page.goto('/find');
    const field = page.getByRole('button', { name: /^Leave around/ });
    await field.focus();
    await page.keyboard.press('Enter');
    const hours = page.getByRole('dialog').getByRole('listbox', { name: 'Hours' });
    // the hour wheel has focus and rests on the first allowed hour (21 or 22, depending on summer time)
    await expect(hours).toBeFocused();
    const first = hours.locator('[role=option][aria-selected=true]');
    await expect(first).toHaveCount(1);
    const next = String(Number(await first.textContent()) + 1);
    await page.keyboard.press('ArrowDown');
    await expect(hours.getByRole('option', { name: next, exact: true })).toHaveAttribute(
      'aria-selected',
      'true',
    );
    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog')).toBeHidden();
    await expect(field).toBeFocused();
    await expect(field).toContainText('Choose'); // Esc cancels, nothing was set
  });

  test('a time that is past today shows the error instead of changing silently', async ({
    page,
  }) => {
    await setup(page);
    await page.goto('/find');
    await pickPlace(page, 'From', 'selimbar', 'Șelimbăr');
    await pickPlace(page, 'To', 'zona', 'Zona Industrială Vest');
    await pickDay(page, 'Day', 'Tomorrow');
    await pickTime(page, 'Leave around', '07:30');
    await pickDay(page, 'Day', 'Today');
    await expect(page.getByRole('button', { name: /^Leave around/ })).toContainText('07:30'); // not changed behind the user's back
    await page.getByRole('button', { name: 'Search rides' }).click();
    await expect(
      page.getByText('That time has already passed. Choose a later time.'),
    ).toBeVisible();
    await expect(page.getByRole('button', { name: /^Leave around/ })).toBeFocused();
    await expect(page.getByRole('button', { name: /^Leave around/ })).toHaveAttribute(
      'aria-invalid',
      'true',
    );
    await expectNoAxeViolations(page);
  });
});
