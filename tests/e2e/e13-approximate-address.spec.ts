import { expect, test, type Page } from '@playwright/test';
import { pickDay, pickTime } from './time-helpers';
import { expectNoAxeViolations, mockAccountApi, seedSession } from './accounts-helpers';
import { mockPopularApi } from './popular-helpers';
import { mockPlaces, mockRidesApi, newFakeRides, readyDriver } from './rides-helpers';
import { mockSearchApi, newFakeSearch } from './search-helpers';

// ADR 0042: any house number is accepted. A street plus a number the gazetteer does not hold comes back as a synthetic
// "approximate" suggestion; the label is exactly what the user typed and the UI says the position is approximate.

const SHOTS = 'docs/screenshots/approx-address';

async function openPicker(page: Page, which: 'From' | 'To', query: string, queries: string[]) {
  await page.getByRole('button', { name: new RegExp(`^${which}`) }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByRole('searchbox').fill(query);
  await expect(dialog.getByRole('heading', { name: /places? found/ })).toBeVisible();
  expect(queries.at(-1)).toBe(query);
  return dialog;
}

async function expectApproxRow(page: Page, shot: string) {
  const dialog = page.getByRole('dialog');
  const row = dialog.getByRole('listitem').first();
  await expect(row).toContainText('Strada Negoveanu 2');
  await expect(row).toContainText('Approximate position');
  await expectNoAxeViolations(page);
  await page.screenshot({ path: `${SHOTS}/${shot}.png` });
  await row.getByRole('button').click();
  await expect(dialog).toBeHidden();
}

test('publish: the approximate suggestion is picked, labelled and sent with its flag', async ({
  page,
}) => {
  const queries: string[] = [];
  const previews: Array<Record<string, unknown>> = [];
  page.on('request', (r) => {
    if (r.method() === 'POST' && r.url().endsWith('/rides/preview'))
      previews.push(r.postDataJSON() as Record<string, unknown>);
  });
  await seedSession(page);
  await mockAccountApi(page, readyDriver());
  await mockPlaces(page, queries);
  await mockRidesApi(page, newFakeRides());

  await page.goto('/offer');
  await openPicker(page, 'From', 'Negoveanu 2', queries);
  await expectApproxRow(page, 'publish-picker-360');

  const from = page.getByRole('button', { name: 'From Strada Negoveanu 2', exact: true });
  await expect(from).toBeVisible();
  await expect(from).not.toContainText('Negoveanu 4');
  const hint = page.getByText(/Start position is approximate/);
  await expect(hint).toBeVisible();
  await expect(from).toHaveAttribute('aria-describedby', /offer-from-approx/);

  await page.getByRole('button', { name: /^To/ }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByRole('searchbox').fill('zona');
  await expect(dialog.getByRole('heading', { name: /places? found/ })).toBeVisible();
  await dialog.getByRole('listitem').first().getByRole('button').click();
  await expect(page.getByText('9.6 km, about 17 min')).toBeVisible();

  expect(previews.at(-1)).toMatchObject({
    originLabel: 'Strada Negoveanu 2',
    originApproximate: true,
    destinationLabel: 'Zona Industrială Vest',
  });
  expect(previews.at(-1)).not.toHaveProperty('destinationApproximate');
  await expect(page.getByText(/Destination position is approximate/)).toHaveCount(0);
  await expectNoAxeViolations(page);
  await page.screenshot({ path: `${SHOTS}/publish-selected-360.png` });
});

test('letters and slashes reach the API unchanged', async ({ page }) => {
  const queries: string[] = [];
  await mockPlaces(page, queries);
  await page.goto('/find');
  await openPicker(page, 'From', 'Negoveanu 2/B', queries);
  await expect(page.getByRole('dialog').getByRole('listitem').first()).toContainText(
    'Strada Negoveanu 2/B',
  );
});

test('find: the approximate point is searched, coordinates only', async ({ page }) => {
  test.slow();
  const queries: string[] = [];
  await page.route('**/telemetry/error', (r) => r.fulfill({ status: 204 }));
  await mockPlaces(page, queries);
  const fake = newFakeSearch();
  await mockSearchApi(page, fake);
  await mockPopularApi(page);

  await page.goto('/find');
  await openPicker(page, 'From', 'Negoveanu 2', queries);
  await expectApproxRow(page, 'find-picker-360');
  await expect(
    page.getByRole('button', { name: 'From Strada Negoveanu 2', exact: true }),
  ).toBeVisible();
  await expect(page.getByText(/Start position is approximate/)).toBeVisible();

  await page.getByRole('button', { name: /^To/ }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByRole('searchbox').fill('zona');
  await expect(dialog.getByRole('heading', { name: /places? found/ })).toBeVisible();
  await dialog.getByRole('listitem').first().getByRole('button').click();
  await pickDay(page, 'Day', 'Tomorrow');
  await pickTime(page, 'Leave around', '07:30');
  await expectNoAxeViolations(page);
  await page.screenshot({ path: `${SHOTS}/find-selected-360.png` });
  await page.getByRole('button', { name: 'Search rides' }).click();

  await expect(page).toHaveURL(/\/results$/);
  expect(fake.searches).toHaveLength(1);
  expect(fake.searches[0]).toMatchObject({ from: { lat: 45.7856, lng: 24.1747 } });
  expect(JSON.stringify(fake.searches[0])).not.toContain('Negoveanu');
  expect(JSON.stringify(fake.searches[0])).not.toContain('approximate');
});
