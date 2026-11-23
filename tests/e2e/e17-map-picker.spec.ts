import { expect, test, type Page } from '@playwright/test';
import { expectNoAxeViolations, mockAccountApi, seedSession } from './accounts-helpers';
import { mockPlaces, mockRidesApi, newFakeRides, readyDriver } from './rides-helpers';

// Choose a place on the map (Find and Offer). The real /tiles/sibiu.pmtiles is served by the preview, so the real map
// renders; POST /places/reverse is mocked deterministically (rides-helpers mockPlaces).

const SHOTS = 'docs/screenshots/find-polish';
const LABEL = 'Strada Nicolae Bălcescu 12';

test.use({ viewport: { width: 360, height: 800 } });

async function openMap(page: Page, which: 'From' | 'To', withLabel = true) {
  await page.getByRole('button', { name: new RegExp(`^${which}`) }).click();
  await page.getByRole('button', { name: 'Choose on map' }).click();
  const map = page.getByRole('dialog', { name: /on the map/ });
  await expect(map).toBeVisible();
  await expect(page.getByTestId('map-pin')).toBeVisible({ timeout: 20_000 });
  if (withLabel) await expect(page.getByTestId('map-label')).toBeVisible();
  return map;
}

async function dragMap(page: Page, dx: number, dy: number) {
  const box = await page.getByRole('region', { name: /Map of Sibiu/ }).boundingBox();
  if (!box) throw new Error('no map');
  const x = box.x + box.width / 2;
  const y = box.y + box.height / 2;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x + dx / 2, y + dy / 2, { steps: 6 });
  await page.mouse.move(x + dx, y + dy, { steps: 6 });
  await page.mouse.up();
}

test('find: drag the map, the address card updates, Confirm fills From', async ({ page }) => {
  const reversed: Array<{ lat: number; lng: number }> = [];
  await mockPlaces(page, [], reversed);
  await page.goto('/find');
  const map = await openMap(page, 'From');

  await expect(page.getByTestId('map-label')).toHaveText(LABEL);
  const before = reversed.length;
  const first = reversed.at(-1);
  await dragMap(page, -120, 90);
  await expect(page.getByText('Moving…')).toHaveCount(0); // settled
  await expect(page.getByTestId('map-label')).toHaveText(LABEL);
  await expect.poll(() => reversed.length).toBeGreaterThan(before);
  const moved = reversed.at(-1);
  expect(moved).not.toEqual(first);

  await expectNoAxeViolations(page);
  await map.getByRole('button', { name: 'Confirm' }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.getByRole('button', { name: `From ${LABEL}`, exact: true })).toBeVisible();
});

test('find: zoom buttons, keyboard and Cancel return to the picker', async ({ page }) => {
  await mockPlaces(page);
  await page.goto('/find');
  const map = await openMap(page, 'To');
  await map.getByRole('button', { name: 'Zoom in' }).click();
  await map.getByRole('button', { name: 'Zoom out' }).click();
  await map.getByRole('button', { name: 'Cancel' }).click();
  await expect(map).toBeHidden();
  // still in the place picker, focus back on the opener
  await expect(page.getByRole('searchbox')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Choose on map' })).toBeFocused();
  await page.getByRole('button', { name: 'Choose on map' }).click();
  await expect(page.getByTestId('map-pin')).toBeVisible({ timeout: 20_000 });
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('map-pin')).toHaveCount(0);
});

test('outside coverage: grey pin, message, Confirm disabled', async ({ page }) => {
  const reversed: Array<{ lat: number; lng: number }> = [];
  await mockPlaces(page, [], reversed);
  await page.goto('/find');
  const map = await openMap(page, 'From');
  const pin = page.getByTestId('map-pin');
  for (let i = 0; i < 20 && (await pin.getAttribute('data-state')) !== 'outside'; i++) {
    await dragMap(page, 300, 0); // drag right: the map moves east -> the centre goes west
  }
  await expect(pin).toHaveAttribute('data-state', 'outside');
  await expect(map.getByText('This place is outside the area we cover')).toBeVisible();
  await expect(map.getByRole('button', { name: 'Confirm' })).toBeDisabled();
  const calls = reversed.length;
  await page.waitForTimeout(700);
  expect(reversed.length).toBe(calls); // no lookup outside the area
  await expectNoAxeViolations(page);
  await page.screenshot({ path: `${SHOTS}/map-outside-360.png` });
});

test('lookup failure: error, Retry and "Use this point anyway" (Pinned location)', async ({
  page,
}) => {
  await mockPlaces(page);
  await page.route('**/places/reverse', (route) =>
    route.fulfill({ status: 500, json: { error: { code: 'INTERNAL', message: 'x' } } }),
  );
  await page.goto('/find');
  await openMap(page, 'From', false);
  await expect(page.getByText('We couldn’t look up an address for this spot.')).toBeVisible({
    timeout: 20_000,
  });
  await expect(
    page.getByRole('dialog', { name: /on the map/ }).getByRole('button', { name: 'Try again' }),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Use this point anyway' }).click();
  await expect(
    page.getByRole('button', { name: 'From Pinned location', exact: true }),
  ).toBeVisible();
});

test('tiles blocked: clear message and Search instead returns to the text picker', async ({
  page,
}) => {
  await mockPlaces(page);
  await page.route('**/tiles/**', (route) => route.abort());
  await page.goto('/find');
  await page.getByRole('button', { name: /^From/ }).click();
  await page.getByRole('button', { name: 'Choose on map' }).click();
  await expect(page.getByText('The map couldn’t load.')).toBeVisible({ timeout: 20_000 });
  await expect(page.getByRole('button', { name: 'Confirm' })).toHaveCount(0);
  await expectNoAxeViolations(page);
  await page.getByRole('button', { name: 'Search instead' }).click();
  await expect(page.getByRole('searchbox')).toBeVisible();
});

test('offer: start and destination are chosen on the map and sent as labels', async ({ page }) => {
  const previews: Array<Record<string, unknown>> = [];
  page.on('request', (r) => {
    if (r.method() === 'POST' && r.url().endsWith('/rides/preview'))
      previews.push(r.postDataJSON() as Record<string, unknown>);
  });
  await seedSession(page);
  await mockAccountApi(page, readyDriver());
  await mockPlaces(page);
  await mockRidesApi(page, newFakeRides());
  await page.goto('/offer');

  let map = await openMap(page, 'From');
  await map.getByRole('button', { name: 'Confirm' }).click();
  await expect(page.getByRole('button', { name: `From ${LABEL}`, exact: true })).toBeVisible();

  map = await openMap(page, 'To');
  await dragMap(page, 120, -150);
  await expect(page.getByTestId('map-label')).toHaveText(LABEL);
  await map.getByRole('button', { name: 'Confirm' }).click();
  await expect(page.getByRole('button', { name: `To ${LABEL}`, exact: true })).toBeVisible();

  await expect.poll(() => previews.length).toBeGreaterThan(0);
  expect(previews.at(-1)).toMatchObject({ originLabel: LABEL, destinationLabel: LABEL });
  expect(previews.at(-1)).not.toHaveProperty('originApproximate');
});

for (const theme of ['dark', 'light'] as const) {
  test(`${theme}: map picker is axe clean and screenshotted`, async ({ page }) => {
    await page.addInitScript((t) => window.localStorage.setItem('haide.theme', t), theme);
    await mockPlaces(page);
    await page.goto('/find');
    await page.getByRole('button', { name: /^From/ }).click();
    await expect(page.getByRole('button', { name: 'Choose on map' })).toBeVisible();
    await page.waitForTimeout(700); // the sheet has finished rising
    await page.screenshot({ path: `${SHOTS}/map-entry-${theme}-360.png` });
    await page.getByRole('button', { name: 'Choose on map' }).click();
    await expect(page.getByTestId('map-pin')).toBeVisible({ timeout: 20_000 });
    await expect(page.getByTestId('map-label')).toBeVisible();
    await page.getByRole('region', { name: /Map of Sibiu/ }).waitFor();
    await page.waitForTimeout(1200); // tiles and labels painted
    await expectNoAxeViolations(page);
    await page.screenshot({ path: `${SHOTS}/map-${theme}-360.png` });
  });
}
