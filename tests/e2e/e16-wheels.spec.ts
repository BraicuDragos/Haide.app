import { expect, test, type Page } from '@playwright/test';
import { expectNoAxeViolations, mockAccountApi, seedSession } from './accounts-helpers';
import { mockPlaces, mockRidesApi, newFakeRides, readyDriver } from './rides-helpers';
import { mockPopularApi } from './popular-helpers';
import { pickDay, pickTime } from './time-helpers';

// The alarm-style Day and time wheels (Find polish, items 4 and 5): one trigger component for both fields (same
// height), a wheel sheet per field, keyboard and tap, past times for today dimmed, Cancel and Set. The clock is fixed
// at about 22:00 in Bucharest so "today" has a past to grey out.

const SHOTS = 'docs/screenshots/find-polish';

async function setup(page: Page) {
  const todayRo = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Bucharest' }).format(
    new Date(),
  );
  await page.route('**/telemetry/error', (r) => r.fulfill({ status: 204 }));
  await mockPlaces(page);
  await mockPopularApi(page);
  await page.clock.setFixedTime(new Date(`${todayRo}T19:30:00Z`));
}

async function setupPublish(page: Page) {
  await setup(page);
  await seedSession(page);
  await mockAccountApi(page, readyDriver());
  await mockRidesApi(page, newFakeRides());
}

const trigger = (page: Page, name: RegExp) => page.getByRole('button', { name });
const DAY = /^Day/;
const LEAVE = /^Leave around/;

async function height(page: Page, id: string) {
  return await page.evaluate((i) => document.getElementById(i)!.getBoundingClientRect().height, id);
}

test.describe('Find: day and time wheels', () => {
  test('Day and Leave around are the same size and shape', async ({ page }) => {
    await setup(page);
    await page.goto('/find');
    await expect(trigger(page, LEAVE)).toBeVisible();
    const day = await page.evaluate(() => {
      const r = document.getElementById('find-day')!.getBoundingClientRect();
      const t = document.getElementById('find-time')!.getBoundingClientRect();
      const cs = (id: string) => getComputedStyle(document.getElementById(id)!);
      return {
        dh: r.height,
        th: t.height,
        dr: cs('find-day').borderRadius,
        tr: cs('find-time').borderRadius,
        df: cs('find-day').fontSize,
        tf: cs('find-time').fontSize,
      };
    });
    expect(day.dh).toBeGreaterThanOrEqual(48);
    expect(Math.abs(day.dh - day.th)).toBeLessThanOrEqual(0.5);
    expect(day.dr).toBe(day.tr);
    expect(day.df).toBe(day.tf);
    // No native select, date or time input left in the row.
    await expect(page.locator('#find-day, #find-time')).toHaveCount(2);
    await expect(
      page.locator('form select, form input[type=date], form input[type=time]'),
    ).toHaveCount(0);
  });

  test('Day: arrow keys to Tomorrow, Set; then a tap on Today; Cancel keeps the day', async ({
    page,
  }) => {
    await setup(page);
    await page.goto('/find');
    const field = trigger(page, DAY);
    await expect(field).toContainText('Today');
    await field.click();
    const sheet = page.getByRole('dialog', { name: 'Day' });
    const wheel = sheet.getByRole('listbox', { name: 'Day' });
    await expect(wheel).toBeFocused();
    await expect(wheel.getByRole('option')).toHaveCount(7);
    await page.keyboard.press('ArrowDown');
    await expect(wheel.getByRole('option', { name: 'Tomorrow' })).toHaveAttribute(
      'aria-selected',
      'true',
    );
    await page.keyboard.press('Enter'); // Enter on a wheel confirms
    await expect(sheet).toBeHidden();
    await expect(field).toContainText('Tomorrow');
    await expect(field).toBeFocused();

    await field.click();
    await wheel.getByRole('option', { name: 'Today' }).click();
    await expect(wheel.getByRole('option', { name: 'Today' })).toHaveAttribute(
      'aria-selected',
      'true',
    );
    await sheet.getByRole('button', { name: 'Cancel' }).click();
    await expect(field).toContainText('Tomorrow'); // Cancel changed nothing

    await field.click();
    await page.keyboard.press('Escape');
    await expect(sheet).toBeHidden();
    await expect(field).toContainText('Tomorrow');
    await expect(field).toBeFocused();
  });

  test('time: type 07:35, Set shows it; Cancel leaves the value; today greys out the past', async ({
    page,
  }) => {
    await setup(page);
    await page.goto('/find');
    const field = trigger(page, LEAVE);
    await expect(field).toContainText('Choose');

    // today: the past hours are dimmed and cannot be chosen
    await field.click();
    const sheet = page.getByRole('dialog', { name: 'Leave around' });
    const hours = sheet.getByRole('listbox', { name: 'Hours' });
    await expect(hours.getByRole('option')).toHaveCount(24);
    await expect(hours.getByRole('option', { name: '07', exact: true })).toHaveAttribute(
      'aria-disabled',
      'true',
    );
    await hours.getByRole('option', { name: '07', exact: true }).click({ force: true });
    await expect(hours.getByRole('option', { name: '07', exact: true })).toHaveAttribute(
      'aria-selected',
      'false',
    );
    await sheet.getByRole('button', { name: 'Cancel' }).click();
    await expect(field).toContainText('Choose');

    await pickDay(page, 'Day', 'Tomorrow');
    await pickTime(page, 'Leave around', '07:35');
    await expect(field).toContainText('07:35');

    // reopening starts on the saved time; Cancel leaves it
    await field.click();
    await expect(sheet.getByRole('option', { name: '35', exact: true })).toHaveAttribute(
      'aria-selected',
      'true',
    );
    await page.keyboard.type('09');
    await sheet.getByRole('button', { name: 'Cancel' }).click();
    await expect(field).toContainText('07:35');
  });

  test('a tap on a row scrolls it to the centre band and selects it', async ({ page }) => {
    await setup(page);
    await page.goto('/find');
    await pickDay(page, 'Day', 'Tomorrow');
    await trigger(page, LEAVE).click();
    const sheet = page.getByRole('dialog', { name: 'Leave around' });
    const hours = sheet.getByRole('listbox', { name: 'Hours' });
    await hours.getByRole('option', { name: '18', exact: true }).click();
    await expect(hours.getByRole('option', { name: '18', exact: true })).toHaveAttribute(
      'aria-selected',
      'true',
    );
    // settled: the row sits in the middle of the wheel
    await expect
      .poll(async () =>
        hours.evaluate((el) => {
          const sel = el.querySelector('[aria-selected=true]') as HTMLElement;
          const w = el.getBoundingClientRect();
          const r = sel.getBoundingClientRect();
          return Math.round(r.top + r.height / 2 - (w.top + w.height / 2));
        }),
      )
      .toBeLessThanOrEqual(1);
    await sheet.getByRole('button', { name: 'Set time' }).click();
    await expect(trigger(page, LEAVE)).toContainText('18:00');
  });

  test('a swipe (touch scroll) settles on a row and selects it', async ({ page }) => {
    await setup(page);
    await page.goto('/find');
    await pickDay(page, 'Day', 'Tomorrow');
    await trigger(page, LEAVE).click();
    const sheet = page.getByRole('dialog', { name: 'Leave around' });
    const hours = sheet.getByRole('listbox', { name: 'Hours' });
    // Scrolling the list (what a swipe does) moves the selection to the row under the band. A person cannot swipe in
    // the first fraction of a second after the sheet opens, while the wheel is still placing itself.
    await expect.poll(() => hours.evaluate((el) => el.scrollTop)).toBe(48 * 8);
    await page.waitForTimeout(250);
    await hours.evaluate((el) => el.scrollTo({ top: 48 * 14 }));
    await expect(hours.getByRole('option', { name: '14', exact: true })).toHaveAttribute(
      'aria-selected',
      'true',
    );
    await sheet.getByRole('button', { name: 'Set time' }).click();
    await expect(trigger(page, LEAVE)).toContainText('14:00');
  });

  test('open sheets pass axe in dark and light at 360px with no sideways scroll', async ({
    page,
  }) => {
    await setup(page);
    await page.goto('/find');
    for (const theme of ['dark', 'light']) {
      await page.evaluate((th) => (document.documentElement.dataset.theme = th), theme);
      await trigger(page, DAY).click();
      await expect(page.getByRole('dialog', { name: 'Day' })).toBeVisible();
      await expectNoAxeViolations(page);
      await page.keyboard.press('Escape');
      await trigger(page, LEAVE).click();
      await expect(page.getByRole('dialog', { name: 'Leave around' })).toBeVisible();
      await expectNoAxeViolations(page);
      expect(
        await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
      ).toBe(true);
      await page.keyboard.press('Escape');
    }
  });

  test('reduced motion: no animated scroll, still selects', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await setup(page);
    await page.goto('/find');
    await pickDay(page, 'Day', 'Tomorrow');
    await pickTime(page, 'Leave around', '12:15');
    await expect(trigger(page, LEAVE)).toContainText('12:15');
  });

  test('screenshots of both sheets (dark and light)', async ({ page }) => {
    await setup(page);
    await page.goto('/find');
    await pickDay(page, 'Day', 'Tomorrow');
    await pickTime(page, 'Leave around', '07:30');
    for (const theme of ['dark', 'light']) {
      await page.evaluate((th) => (document.documentElement.dataset.theme = th), theme);
      await trigger(page, DAY).click();
      await page.getByRole('dialog', { name: 'Day' }).waitFor();
      await page.waitForTimeout(700);
      await page.screenshot({ path: `${SHOTS}/wheels-day-${theme}.png` });
      await page.keyboard.press('Escape');
      await trigger(page, LEAVE).click();
      await page.getByRole('dialog', { name: 'Leave around' }).waitFor();
      await page.waitForTimeout(700);
      await page.screenshot({ path: `${SHOTS}/wheels-time-${theme}.png` });
      await page.keyboard.press('Escape');
    }
    await page.evaluate(() => (document.documentElement.dataset.theme = 'dark'));
    await page.screenshot({ path: `${SHOTS}/wheels-find-fields-dark.png` });
  });
});

test.describe('Publish: day and time wheels', () => {
  test('Day and Leaving at are the same height; the same flow works', async ({ page }) => {
    await setupPublish(page);
    await page.goto('/offer');
    await expect(trigger(page, /^Leaving at/)).toBeVisible();
    expect(
      Math.abs((await height(page, 'offer-day')) - (await height(page, 'offer-time'))),
    ).toBeLessThanOrEqual(0.5);
    await pickDay(page, 'Day', 'Tomorrow');
    await expect(trigger(page, DAY)).toContainText('Tomorrow');
    await pickTime(page, 'Leaving at', '07:35');
    await expect(trigger(page, /^Leaving at/)).toContainText('07:35');
    await expect(
      page.locator('form select, form input[type=date], form input[type=time]'),
    ).toHaveCount(0);
  });

  test('today greys out times before now + 15 minutes', async ({ page }) => {
    await setupPublish(page);
    await page.goto('/offer');
    await trigger(page, /^Leaving at/).click();
    const hours = page
      .getByRole('dialog', { name: 'Leaving at' })
      .getByRole('listbox', { name: 'Hours' });
    await expect(hours.getByRole('option', { name: '07', exact: true })).toHaveAttribute(
      'aria-disabled',
      'true',
    );
    await page.keyboard.press('Escape');
  });

  test('the repeat "until" date is a day wheel and passes axe', async ({ page }) => {
    await setupPublish(page);
    await page.goto('/offer');
    await page.getByRole('switch', { name: /Repeat on weekdays/ }).click();
    const until = trigger(page, /^Until/);
    await expect(until).toBeVisible();
    await until.click();
    const sheet = page.getByRole('dialog', { name: 'Until' });
    await expect(sheet).toBeVisible();
    await expectNoAxeViolations(page);
    await page.keyboard.press('End');
    await sheet.getByRole('button', { name: 'Set day' }).click();
    await expect(until).not.toContainText('Choose');
    await expect(page.getByText(/^Creates \d+ rides?$/)).toBeVisible();
  });
});
