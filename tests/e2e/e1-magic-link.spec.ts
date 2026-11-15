import { expect, test, type APIRequestContext } from '@playwright/test';
import { expectNoAxeViolations, PNG_1X1 } from './accounts-helpers';

/**
 * E1 happy path against the REAL local stack: magic-link sign-up through the Mailpit mail catcher, then agreement,
 * profile, car, sign out, Back.
 *
 * Runs only when E2E_MAILPIT_URL is set (CI integration job: http://127.0.0.1:54324). The web build also needs
 * VITE_SUPABASE_URL, VITE_SUPABASE_PUBLISHABLE_KEY and VITE_API_BASE_URL, and the API must allow the preview origin
 * (CORS_ORIGINS includes http://localhost:4173). See the PR notes for the exact CI additions.
 */
const MAILPIT = process.env.E2E_MAILPIT_URL?.replace(/\/+$/, '');

interface MailpitList {
  messages: Array<{ ID: string; To: Array<{ Address: string }> }>;
}

async function magicLinkFor(request: APIRequestContext, email: string): Promise<string> {
  let link = '';
  await expect
    .poll(
      async () => {
        const list = (await (
          await request.get(`${MAILPIT}/api/v1/messages`)
        ).json()) as MailpitList;
        const hit = list.messages.find((m) => m.To.some((t) => t.Address === email));
        if (!hit) return '';
        const msg = (await (await request.get(`${MAILPIT}/api/v1/message/${hit.ID}`)).json()) as {
          Text?: string;
          HTML?: string;
        };
        const body = `${msg.Text ?? ''}\n${msg.HTML ?? ''}`.replaceAll('&amp;', '&');
        link = /https?:\/\/[^\s"'<>]+\/auth\/v1\/verify\?[^\s"'<>]+/.exec(body)?.[0] ?? '';
        return link;
      },
      { timeout: 30_000, message: 'magic-link email did not arrive in Mailpit' },
    )
    .not.toBe('');
  return link;
}

test.describe('magic-link sign-up (real stack)', () => {
  test.skip(
    !MAILPIT,
    'set E2E_MAILPIT_URL (for example http://127.0.0.1:54324) to run against the local stack',
  );

  test('sign up, agree, profile, car, sign out, Back shows nothing protected', async ({
    page,
    request,
    baseURL,
  }) => {
    const email = `e2e-${Date.now()}@example.com`;

    // Start as a driver so all four steps run.
    await page.goto('/offer');
    await page.getByRole('button', { name: 'Sign in or create account' }).click();
    await page.getByLabel('Email address').fill(email);
    await page.getByRole('button', { name: 'Email me a sign-in link' }).click();
    await expect(page.getByRole('heading', { level: 1, name: 'Check your email' })).toBeVisible();

    // Verify the link without a browser hop, then land on OUR origin: the PKCE verifier lives in this page's storage.
    const verify = await request.get(await magicLinkFor(request, email), { maxRedirects: 0 });
    expect([302, 303]).toContain(verify.status());
    const target = new URL(verify.headers().location ?? '');
    await page.goto(`${baseURL}/auth/callback${target.search}`);

    // Step 2: agreement
    await expect(page.getByRole('heading', { level: 1, name: 'Before you start' })).toBeVisible();
    await expect(page.getByText('Step 2 of 4')).toBeVisible();
    await expectNoAxeViolations(page);
    await page.getByRole('checkbox', { name: 'I am 18 or older' }).check();
    await page.getByRole('checkbox', { name: /I accept the/ }).check();
    await page.getByRole('button', { name: 'Agree and continue' }).click();

    // Step 3: profile (photo is resized to JPEG in the browser first)
    await expect(
      page.getByRole('heading', { level: 1, name: 'Tell your neighbours who you are' }),
    ).toBeVisible();
    await page.locator('input[type=file]').setInputFiles({
      name: 'me.png',
      mimeType: 'image/png',
      buffer: PNG_1X1,
    });
    await page.getByLabel('First name').fill('Ștefan');
    await page.getByLabel('Phone number').fill('0721 234 567');
    await page.getByRole('button', { name: 'Save and continue' }).click();

    // Step 4: car
    await expect(page.getByRole('heading', { level: 1, name: 'Your car' })).toBeVisible();
    await expect(page.getByText('Step 4 of 4')).toBeVisible();
    await page.getByLabel('Make').fill('Dacia');
    await page.getByLabel('Model').fill('Logan');
    await page.getByLabel('Colour').fill('Grey');
    await page.getByLabel('Number plate').fill('SB 12 ABC');
    await page.getByLabel('Fuel type').selectOption('petrol');
    await page.getByLabel('Seats for passengers').selectOption('3');
    await page.getByRole('button', { name: 'Save car' }).click();

    // Return-to-intent: back on Offer.
    await expect(page).toHaveURL(/\/offer$/);
    await expect(page.getByRole('heading', { level: 1, name: 'Offer a ride' })).toBeVisible();

    // The session persists across a reload.
    await page.reload();
    await page
      .getByRole('navigation', { name: 'Main' })
      .getByRole('link', { name: 'Profile' })
      .click();
    await expect(page.getByText(email)).toBeVisible();
    await expect(page.getByText('Dacia Logan, Grey')).toBeVisible();

    // Sign out, then Back must not reveal protected content.
    await page.getByRole('button', { name: 'Sign out' }).click();
    await expect(page).toHaveURL(/\/find$/);
    await page.goBack();
    await expect(
      page.getByRole('heading', { level: 2, name: 'Join your neighbours' }),
    ).toBeVisible();
    await expect(page.getByText(email)).toHaveCount(0);
  });
});
