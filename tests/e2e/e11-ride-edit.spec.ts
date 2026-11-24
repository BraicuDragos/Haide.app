import { expect, test, type Page } from '@playwright/test';
import { expectNoAxeViolations, mockAccountApi, seedSession } from './accounts-helpers';
import {
  mockPlaces,
  mockRidesApi,
  newFakeRides,
  readyDriver,
  TRIP_B,
  type FakeRides,
} from './rides-helpers';
import { pickDay, pickTime } from './time-helpers';

// Editing a published ride (ADR 0041) at 360x800. The API is mocked with the stateful rides fake, which mirrors
// PATCH /rides/{id}: the server rules themselves are covered by the backend tests.

const RIDE_ID = '10000000-0000-4000-8000-000000000042';

function departure(daysAhead: number, hour: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + daysAhead);
  d.setUTCHours(hour, 0, 0, 0);
  return d.toISOString();
}

/** The Europe/Bucharest calendar day `n` days from now, as YYYY-MM-DD (the value of a row on the Day wheel). */
function daysAhead(n: number): string {
  const d = new Date(Date.now() + n * 86_400_000);
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Bucharest' }).format(d);
}

const person = {
  id: 'u-9',
  firstName: 'Radu',
  photoUrl: null,
  memberSince: '2026-09',
  rating: null,
  ridesCompleted: 0,
  lateCancellations90d: 0,
  noShows90d: 0,
  bio: null,
};

async function setup(page: Page, withPassengers: boolean): Promise<FakeRides> {
  const fake = newFakeRides();
  fake.rides.push({
    id: RIDE_ID,
    status: 'published',
    departureAt: departure(3, 5),
    origin: { point: { lat: 45.7595, lng: 24.2128 }, label: 'Șelimbăr, Shopping City' },
    destination: { point: { lat: 45.7926, lng: 24.0973 }, label: 'Zona Industrială Vest' },
    route: {
      type: 'LineString',
      coordinates: [
        [24.2128, 45.7595],
        [24.15, 45.78],
        [24.0973, 45.7926],
      ],
    },
    distanceM: TRIP_B.distanceM,
    durationS: TRIP_B.durationS,
    seatsOffered: 3,
    seatsBooked: withPassengers ? 1 : 0,
    note: 'Near the red kiosk',
    isFree: false,
    autoAccept: false,
    series: null,
    priceTable: TRIP_B.priceTable,
    tripCostBani: TRIP_B.tripCostBani,
    fuelType: 'diesel',
    car: { make: 'Dacia', model: 'Logan', colour: 'Grey', plate: 'SB12ABC' },
    requests: withPassengers
      ? [
          {
            bookingId: 'b-req',
            passenger: person,
            pickupLabel: 'Șelimbăr',
            dropoffLabel: 'Zona Industrială Vest',
            segmentM: 8000,
            priceIfAcceptedBani: 200,
            requestedAt: new Date().toISOString(),
            expiresAt: departure(1, 5),
          },
        ]
      : [],
    passengers: withPassengers
      ? [
          {
            bookingId: 'b-ok',
            status: 'confirmed',
            passenger: { ...person, id: 'u-8', firstName: 'Maria' },
            pickup: { point: { lat: 45.76, lng: 24.2 }, label: 'Șelimbăr' },
            dropoff: { point: { lat: 45.79, lng: 24.1 }, label: 'Zona Industrială Vest' },
            phoneE164: null,
            priceLockedBani: 200,
            finalPriceBani: null,
            noShowBy: null,
            canMarkNoShow: false,
            canRate: false,
            rateUntil: null,
            ratingGiven: null,
          },
        ]
      : [],
    canCancel: true,
    canEdit: true,
    lateCancelIfNow: false,
    lateCancel: false,
    cancelledAt: null,
    createdAt: new Date().toISOString(),
  });
  await page.route('**/telemetry/error', (r) => r.fulfill({ status: 204 }));
  await seedSession(page);
  await mockAccountApi(page, readyDriver());
  await mockPlaces(page);
  await mockRidesApi(page, fake);
  return fake;
}

const sheet = (page: Page) => page.getByRole('dialog', { name: 'Edit ride' });

test.describe('edit a ride (360x800)', () => {
  test('change the time: passengers are named, save, the new time shows', async ({ page }) => {
    const fake = await setup(page, true);
    await page.goto(`/driving/${RIDE_ID}`);
    await page.getByRole('button', { name: 'Edit ride' }).click();
    await expect(sheet(page)).toBeVisible();
    await expect(sheet(page).getByText(/route and the price can’t be changed/)).toBeVisible();
    await expect(sheet(page).getByRole('button', { name: 'Save changes' })).toBeDisabled();
    await expect(sheet(page).getByText(/will be told about the new time/)).toHaveCount(0);

    await pickTime(page, 'Leaving at', '09:25');
    await expect(
      sheet(page).getByText('2 passengers will be told about the new time.'),
    ).toBeVisible();
    await expectNoAxeViolations(page);

    await sheet(page).getByRole('button', { name: 'Save changes' }).click();
    await expect(sheet(page)).toBeHidden();
    await expect(page.getByText('Ride updated, passengers told')).toBeVisible();
    await expect(page.locator('.type-numeral')).toHaveText('09:25');
    expect(fake.edits).toHaveLength(1);
    expect(Object.keys(fake.edits[0]!)).toEqual(['departureAt']);
  });

  test('change only the note: only the note is sent and nobody is told', async ({ page }) => {
    const fake = await setup(page, true);
    await page.goto(`/driving/${RIDE_ID}`);
    await page.getByRole('button', { name: 'Edit ride' }).click();
    await sheet(page)
      .getByLabel(/Note for passengers/)
      .fill('Blue car, by the bakery');
    await expect(sheet(page).getByText(/will be told/)).toHaveCount(0);
    await sheet(page).getByRole('button', { name: 'Save changes' }).click();
    await expect(page.getByText('Ride updated', { exact: true })).toBeVisible();
    await expect(page.getByText('Blue car, by the bakery')).toBeVisible();
    expect(fake.edits[0]).toEqual({ note: 'Blue car, by the bakery' });
  });

  test('seats below the passengers are not selectable', async ({ page }) => {
    const fake = await setup(page, true);
    fake.rides[0]!.seatsBooked = 2;
    await page.goto(`/driving/${RIDE_ID}`);
    await page.getByRole('button', { name: 'Edit ride' }).click();
    await expect(sheet(page).getByRole('radio', { name: '1 seat' })).toBeDisabled();
    await expect(sheet(page).getByRole('radio', { name: '2 seats' })).toBeEnabled();
    await expect(
      sheet(page).getByText('2 seats are already taken, so you can’t offer fewer.'),
    ).toBeVisible();
  });

  test('DAILY_RIDE_LIMIT shows inline at the day field and keeps the sheet open', async ({
    page,
  }) => {
    const fake = await setup(page, false);
    fake.failNext.edit = [409, 'DAILY_RIDE_LIMIT'];
    await page.goto(`/driving/${RIDE_ID}`);
    await page.getByRole('button', { name: 'Edit ride' }).click();
    await pickDay(page, 'Day', daysAhead(5));
    await sheet(page).getByRole('button', { name: 'Save changes' }).click();
    await expect(
      sheet(page).getByText('You’ve reached 4 rides on that day. Choose another day.'),
    ).toBeVisible();
    await expect(sheet(page).getByRole('button', { name: /^Day/ })).toBeFocused();
    await expectNoAxeViolations(page);
    await expect(sheet(page)).toBeVisible();
  });

  test('a ride that cannot be edited has no Edit button', async ({ page }) => {
    const fake = await setup(page, false);
    fake.rides[0]!.canEdit = false;
    await page.goto(`/driving/${RIDE_ID}`);
    await expect(page.getByRole('button', { name: 'Cancel ride' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Edit ride' })).toHaveCount(0);
  });

  test('screenshot for the PR', async ({ page }) => {
    await setup(page, true);
    await page.goto(`/driving/${RIDE_ID}`);
    await page.getByRole('button', { name: 'Edit ride' }).click();
    await pickTime(page, 'Leaving at', '09:25');
    await page.waitForTimeout(600);
    await page.screenshot({ path: 'docs/screenshots/ride-edit/edit-sheet.png' });
  });
});
