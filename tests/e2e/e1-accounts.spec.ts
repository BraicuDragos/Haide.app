import { expect, test, type Page } from '@playwright/test';
import {
  expectNoAxeViolations,
  mockAccountApi,
  newAccount,
  PNG_1X1,
  publicUser,
  seedIntent,
  seedSession,
} from './accounts-helpers';
import { makeImage } from './photo-helpers';

// E1 (accounts, profile, vehicle). The API and the Supabase auth endpoints are mocked, so these run anywhere; the
// full magic-link round trip against the local stack is in e1-magic-link.spec.ts.

const heading = (page: Page, name: string | RegExp) =>
  page.getByRole('heading', { level: 1, name });

test.describe('signed out', () => {
  test('Profile shows the join card and the policy links, axe clean', async ({ page }) => {
    await page.goto('/profile');
    await expect(
      page.getByRole('heading', { level: 2, name: 'Join your neighbours' }),
    ).toBeVisible();
    await expect(page.getByRole('button', { name: 'Sign in or create account' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Privacy policy' })).toBeVisible();
    await expectNoAxeViolations(page);
  });

  for (const [path, title, text] of [
    ['/policy/terms', 'Terms of use', 'You must be 18 or older, have one account only'],
    ['/policy/privacy', 'Privacy policy', 'Data controller: Dragoș Braicu, a private individual'],
  ] as const) {
    test(`${path} is reachable signed out`, async ({ page }) => {
      await page.route('**/legal/current', (r) => r.abort());
      await page.goto(path);
      await expect(heading(page, title)).toBeVisible();
      await expect(page.getByText(text)).toBeVisible();
      await expect(page.getByText('Version 1.2, in force from 22 November 2026')).toBeVisible();
      await expect(page.getByText(/to be confirmed|to be added before launch/)).toHaveCount(0);
      await expectNoAxeViolations(page);
    });
  }

  test('Offer starts onboarding: subtitle names the action, email is validated, link is requested', async ({
    page,
  }) => {
    await page.route('**/auth/v1/otp*', (r) => r.fulfill({ json: {} }));
    await page.goto('/offer');
    await page.getByRole('button', { name: 'Sign in or create account' }).click();
    await expect(heading(page, 'Sign in or create an account')).toBeVisible();
    await expect(page.getByText('You need an account to offer a ride.')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Continue with Google' })).toBeVisible();
    await expectNoAxeViolations(page);

    await page.getByRole('button', { name: 'Email me a sign-in link' }).click();
    const email = page.getByLabel('Email address');
    await expect(page.getByRole('alert').first()).toContainText('Enter an email address like');
    await expect(email).toBeFocused();
    await expect(email).toHaveAttribute('aria-invalid', 'true');
    await expectNoAxeViolations(page);

    await email.fill('ioana@example.com');
    await page.getByRole('button', { name: 'Email me a sign-in link' }).click();
    await expect(heading(page, 'Check your email')).toBeVisible();
    await expect(page.getByText('ioana@example.com', { exact: false })).toBeVisible();
    await expect(page.getByText('works once and expires in 15 minutes')).toBeVisible();
    await expectNoAxeViolations(page);

    await page.getByRole('button', { name: 'Send a new link' }).click();
    await expect(page.getByText('New link sent')).toBeVisible();
    await page.getByRole('button', { name: 'Use a different email' }).click();
    await expect(heading(page, 'Sign in or create an account')).toBeVisible();
  });

  test('closing sign-in returns to where the person was', async ({ page }) => {
    await page.goto('/rides');
    await page.getByRole('button', { name: 'Sign in or create account' }).click();
    await page.getByRole('button', { name: 'Close' }).click();
    await expect(page).toHaveURL(/\/rides$/);
  });

  test('an expired or reused link says so and offers a new one', async ({ page }) => {
    await page.goto(
      '/auth/callback?error=access_denied&error_code=otp_expired&error_description=Email+link+is+invalid',
    );
    await expect(heading(page, 'This link didn’t work')).toBeVisible();
    await expect(
      page.getByText('This link has expired or was already used. Request a new one.'),
    ).toBeVisible();
    await expectNoAxeViolations(page);
    await page.getByRole('button', { name: 'Send a new link' }).click();
    await expect(heading(page, 'Sign in or create an account')).toBeVisible();
  });

  test('account-only screens send a signed-out visitor to sign in', async ({ page }) => {
    await page.goto('/profile/edit');
    await expect(heading(page, 'Sign in or create an account')).toBeVisible();
  });
});

test.describe('public profile', () => {
  test('new member: no rating, no private data, axe clean', async ({ page }) => {
    await page.route('**/users/u-2', (r) => r.fulfill({ json: publicUser() }));
    await page.goto('/user/u-2');
    await expect(heading(page, 'Radu')).toBeVisible();
    await expect(page.getByText('New to Haide')).toBeVisible();
    await expect(page.getByText('Ratings show after 3 ratings.')).toBeVisible();
    await expect(page.getByText('Member since September 2026')).toBeVisible();
    await expect(page.getByText('0 rides completed')).toBeVisible();
    await expect(
      page.getByText('Phone number and car plate are never shown on profiles.'),
    ).toBeVisible();
    await expect(page.getByText(/\+40|plate:/i)).toHaveCount(0);
    await expectNoAxeViolations(page);
  });

  test('rated member shows the average and the count', async ({ page }) => {
    await page.route('**/users/u-2', (r) =>
      r.fulfill({
        json: publicUser({
          rating: { average: 4.8, count: 12 },
          ridesCompleted: 1,
          bio: 'Commute from Șelimbăr.',
        }),
      }),
    );
    await page.goto('/user/u-2');
    await expect(page.getByText('4.8 from 12 ratings')).toBeVisible();
    await expect(page.getByText('1 ride completed')).toBeVisible();
    await expect(page.getByRole('heading', { level: 2, name: 'About Radu' })).toBeVisible();
    await expect(page.getByText('Commute from Șelimbăr.')).toBeVisible();
    await expectNoAxeViolations(page);
  });

  test('unknown or hidden profile (404) and a server error', async ({ page }) => {
    await page.route('**/users/gone', (r) =>
      r.fulfill({
        status: 404,
        json: { error: { code: 'NOT_FOUND', message: 'x', requestId: 'r' } },
      }),
    );
    await page.goto('/user/gone');
    await expect(heading(page, 'This profile isn’t available')).toBeVisible();
    await expectNoAxeViolations(page);

    await page.route('**/users/boom', (r) =>
      r.fulfill({
        status: 500,
        json: { error: { code: 'INTERNAL', message: 'x', requestId: 'r' } },
      }),
    );
    await page.goto('/user/boom');
    await expect(page.getByRole('alert')).toContainText('That didn’t work');
    await expect(page.getByRole('button', { name: 'Try again' })).toBeVisible();
  });
});

test.describe('signed in: onboarding', () => {
  test('passenger path: 3 steps, then back to the place they came from', async ({ page }) => {
    const acc = newAccount();
    await seedSession(page);
    await seedIntent(page, { kind: 'request', returnTo: '/find' });
    await mockAccountApi(page, acc);

    // Step 2: agreement
    await page.goto('/auth/consent');
    await expect(heading(page, 'Before you start')).toBeVisible();
    await expect(page.getByText('Step 2 of 3')).toBeVisible();
    await expectNoAxeViolations(page);

    await page.getByRole('button', { name: 'Agree and continue' }).click();
    const age = page.getByRole('checkbox', { name: 'I am 18 or older' });
    await expect(age).toBeFocused();
    await expect(page.getByRole('alert').first()).toContainText('Confirm that you are 18 or older');
    await age.check();
    await page.getByRole('button', { name: 'Agree and continue' }).click();
    await expect(page.getByRole('alert').first()).toContainText(
      'Accept the Terms of use and Privacy policy',
    );
    await expect(page.getByRole('checkbox', { name: /I accept the/ })).toBeFocused();
    await expectNoAxeViolations(page);

    // Checkboxes survive a trip to the policy page.
    await page.getByRole('link', { name: 'Terms of use' }).click();
    await expect(heading(page, 'Terms of use')).toBeVisible();
    await page.getByRole('button', { name: 'Back' }).click();
    await expect(page.getByRole('checkbox', { name: 'I am 18 or older' })).toBeChecked();

    await page.getByRole('checkbox', { name: /I accept the/ }).check();
    await page.getByRole('button', { name: 'Agree and continue' }).click();

    // Step 3: profile
    await expect(heading(page, 'Tell your neighbours who you are')).toBeVisible();
    await expect(page.getByText('Step 3 of 3')).toBeVisible();
    await expectNoAxeViolations(page);

    await page.getByRole('button', { name: 'Save and continue' }).click();
    await expect(page.getByText('Add a photo so people can recognise you.')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Add photo' })).toBeFocused();
    await expect(page.getByText('Enter your first name, up to 30 letters.')).toBeVisible();
    await expect(
      page.getByText('Enter a Romanian mobile number, like 0721 234 567.'),
    ).toBeVisible();
    await expectNoAxeViolations(page);

    await page
      .locator('input[type=file]')
      .setInputFiles(await makeImage(page, 800, 600, 'image/png'));
    await page.getByRole('button', { name: 'Use photo' }).click(); // the crop dialog (see e9-photo-crop.spec.ts)
    await expect(page.getByRole('button', { name: 'Change photo' })).toBeVisible();
    await page.getByLabel('First name').fill('Ștefan');
    await page.getByLabel('Phone number').fill('0269 123 456');
    await page.getByRole('button', { name: 'Save and continue' }).click();
    await expect(
      page.getByText('Enter a Romanian mobile number, like 0721 234 567.'),
    ).toBeVisible();
    await expect(page.getByLabel('Phone number')).toBeFocused();

    await page.getByLabel('Phone number').fill('0721 234 567');
    await page.getByLabel(/About you/).fill('Șelimbăr to the old town.');
    await page.getByRole('button', { name: 'Save and continue' }).click();

    // Return-to-intent: passengers have no car step, so the flow ends where it started (Find).
    await expect(page).toHaveURL(/\/find$/);
    expect(acc.me.firstName).toBe('Ștefan');
    expect(acc.me.phoneE164).toBe('+40721234567');
    // The upload is a re-encoded JPEG, not the original PNG.
    expect(acc.upload?.contentType).toContain('multipart/form-data');
    expect(acc.upload?.bytes.includes(Buffer.from([0xff, 0xd8, 0xff]))).toBe(true);
    expect(acc.upload?.bytes.includes(Buffer.from('image/jpeg'))).toBe(true);
  });

  test('driver path: 4 steps, the car comes last, then back to Offer', async ({ page }) => {
    const acc = newAccount({
      consent: { upToDate: true, required: [] },
      firstName: 'Ioana',
      phoneE164: '+40721234567',
      photoUrl: 'data:image/png;base64,' + PNG_1X1.toString('base64'),
      profileComplete: true,
    });
    await seedSession(page);
    await mockAccountApi(page, acc);

    await page.goto('/offer');
    await expect(heading(page, 'Offer a ride')).toBeVisible();
    await expect(page.getByRole('heading', { level: 2, name: 'Add your car first' })).toBeVisible();
    await expectNoAxeViolations(page);
    await page.getByRole('button', { name: 'Add car' }).click();

    await expect(heading(page, 'Your car')).toBeVisible();
    await expect(page.getByText('Step 4 of 4')).toBeVisible();
    await expectNoAxeViolations(page);

    await page.getByRole('button', { name: 'Save car' }).click();
    await expect(page.getByLabel('Make')).toBeFocused();
    await expect(page.getByText('Enter your number plate, like SB 38 AND.')).toBeVisible();
    await expect(page.getByText('Fill in this field.').first()).toBeVisible();
    await expectNoAxeViolations(page);

    await page.getByLabel('Make').fill('Dacia');
    await page.getByLabel('Model').fill('Logan');
    await page.getByLabel('Colour').fill('Grey');
    await page.getByLabel('Number plate').fill('sb 12 abc');
    await page.getByLabel('Fuel type').selectOption('petrol');
    await page.getByLabel('Seats for passengers').selectOption('3');
    await page.getByRole('button', { name: 'Save car' }).click();

    await expect(page).toHaveURL(/\/offer$/);
    await expect(page.getByRole('button', { name: /^From/ })).toBeVisible();
    await expect(page.getByText('Your car has 3 seats.')).toBeVisible();
    expect(acc.vehicle).toMatchObject({ plate: 'SB12ABC', fuelType: 'petrol', seats: 3 });
  });

  test('declining the agreement signs out and returns to Find', async ({ page }) => {
    await seedSession(page);
    await mockAccountApi(page, newAccount());
    await page.goto('/auth/consent');
    await page.getByRole('button', { name: 'Decline and sign out' }).click();
    await expect(page).toHaveURL(/\/find$/);
    await page.goto('/profile');
    await expect(
      page.getByRole('heading', { level: 2, name: 'Join your neighbours' }),
    ).toBeVisible();
  });
});

test.describe('signed in: profile hub', () => {
  const complete = () =>
    newAccount({
      consent: { upToDate: true, required: [] },
      firstName: 'Ioana',
      phoneE164: '+40721234567',
      photoUrl: 'data:image/png;base64,' + PNG_1X1.toString('base64'),
      profileComplete: true,
      hasVehicle: true,
    });

  test('own profile, edit profile, edit car, axe clean', async ({ page }) => {
    const acc = complete();
    acc.vehicle = {
      make: 'Dacia',
      model: 'Logan',
      colour: 'Grey',
      plate: 'SB12ABC',
      fuelType: 'petrol',
      seats: 3,
    };
    await seedSession(page);
    await mockAccountApi(page, acc);

    await page.goto('/profile');
    await expect(page.getByRole('heading', { level: 1, name: 'Profile' })).toBeVisible();
    await expect(page.getByText('Ioana', { exact: true })).toBeVisible();
    await expect(page.getByText('Dacia Logan, Grey')).toBeVisible();
    // The plate is private: not even on the owner's hub.
    await expect(page.getByText('SB12ABC')).toHaveCount(0);
    await expectNoAxeViolations(page);

    await page.getByRole('link', { name: /Edit profile/ }).click();
    await expect(heading(page, 'Edit profile')).toBeVisible();
    await expect(page.getByLabel('First name')).toHaveValue('Ioana');
    await expectNoAxeViolations(page);
    await page.getByLabel('First name').fill('Ioana-Maria');
    await page.getByRole('button', { name: 'Save changes' }).click();
    await expect(page).toHaveURL(/\/profile$/);
    await expect(page.getByText('Profile saved')).toBeVisible();
    await expect(page.getByText('Ioana-Maria', { exact: true })).toBeVisible();

    await page.getByRole('link', { name: /My car/ }).click();
    await expect(heading(page, 'Your car')).toBeVisible();
    await expect(page.getByLabel('Make')).toHaveValue('Dacia');
    await expect(page.getByText('Changing your car doesn’t change rides')).toBeVisible();
    await expectNoAxeViolations(page);
  });

  test('sign out clears the session and Back never reveals a protected screen', async ({
    page,
  }) => {
    await seedSession(page);
    await mockAccountApi(page, complete());
    await page.goto('/find');
    await page
      .getByRole('navigation', { name: 'Main' })
      .getByRole('link', { name: 'Profile' })
      .click();
    await expect(page.getByText('ioana@example.com')).toBeVisible();

    await page.getByRole('button', { name: 'Sign out' }).click();
    await expect(page).toHaveURL(/\/find$/);
    await expect(page.getByText('Signed out')).toBeVisible();

    // Sign-out replaced the Profile entry, so Back cannot return to it. Opening it again shows the join card.
    await page.goBack();
    await expect(page).toHaveURL(/\/find$/);
    await page.goto('/profile');
    await expect(
      page.getByRole('heading', { level: 2, name: 'Join your neighbours' }),
    ).toBeVisible();
    await expect(page.getByText('ioana@example.com')).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Sign out' })).toHaveCount(0);
    expect(await page.evaluate(() => localStorage.getItem('haide.auth'))).toBeNull();
  });

  test('terms bumped: the hub offers the agreement again', async ({ page }) => {
    const acc = complete();
    acc.me.consent = { upToDate: false, required: ['terms'] };
    await seedSession(page);
    await mockAccountApi(page, acc);
    await page.goto('/profile');
    await expect(
      page.getByRole('heading', { level: 2, name: 'Finish setting up your account' }),
    ).toBeVisible();
    await page.getByRole('link', { name: 'Continue setup' }).click();
    await expect(heading(page, 'Before you start')).toBeVisible();
    await expectNoAxeViolations(page);
  });

  test('screens fit a 360 px phone without horizontal scroll', async ({ page }) => {
    await seedSession(page);
    await mockAccountApi(page, complete());
    for (const path of ['/profile', '/profile/edit', '/profile/car', '/policy/privacy']) {
      await page.goto(path);
      await page.waitForLoadState('networkidle');
      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
      );
      expect(overflow, path).toBe(false);
    }
  });
});
