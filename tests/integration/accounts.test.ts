import { Image } from 'imagescript';
import { SignJWT } from 'jose';
import { describe, expect, it } from 'vitest';
import {
  legalCurrentResponseSchema,
  meResponseSchema,
  photoResponseSchema,
  publicUserSchema,
  vehicleResponseSchema,
} from '../../supabase/functions/_shared/contracts/account.ts';
import { errorEnvelopeSchema } from '../../supabase/functions/_shared/contracts/errors.ts';

/**
 * Black-box account flow against the local stack (see api.test.ts for how to start it).
 * Needs LOCAL_JWT_SECRET (the same value the function runs with) to mint access tokens for
 * throw-away users. Skipped otherwise, so `pnpm test` never needs the stack.
 */
const BASE = process.env.API_BASE_URL;
const SECRET = process.env.LOCAL_JWT_SECRET;
const ISSUER = process.env.JWT_ISSUER ?? 'http://127.0.0.1:54321/auth/v1';

async function tokenFor(userId: string, email: string) {
  return new SignJWT({ email })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(userId)
    .setIssuer(ISSUER)
    .setAudience('authenticated')
    .setIssuedAt()
    .setExpirationTime('10m')
    .sign(new TextEncoder().encode(SECRET));
}

describe.skipIf(!BASE || !SECRET)('accounts against the local stack', () => {
  const userId = crypto.randomUUID();
  const email = `it-${userId.slice(0, 8)}@example.com`;
  let auth: Record<string, string> = {};
  const call = (path: string, init: RequestInit = {}) =>
    fetch(`${BASE}${path}`, { ...init, headers: { ...auth, ...(init.headers as object) } });
  const json = (method: string, body: unknown) => ({
    method,
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  const errorOf = async (res: Response) => errorEnvelopeSchema.parse(await res.json()).error;

  it('GET /legal/current is public', async () => {
    const res = await fetch(`${BASE}/legal/current`);
    expect(res.status).toBe(200);
    expect(legalCurrentResponseSchema.parse(await res.json()).terms.version).toBe('1.0');
  });

  it('GET /me needs a token, and a bad issuer is refused', async () => {
    expect((await fetch(`${BASE}/me`)).status).toBe(401);
    const forged = await new SignJWT({})
      .setProtectedHeader({ alg: 'HS256' })
      .setSubject(userId)
      .setIssuer('https://evil.example.com/auth/v1')
      .setAudience('authenticated')
      .setExpirationTime('5m')
      .sign(new TextEncoder().encode(SECRET));
    expect(
      (await fetch(`${BASE}/me`, { headers: { authorization: `Bearer ${forged}` } })).status,
    ).toBe(401);
  });

  it('a new user starts with all consents outstanding', async () => {
    auth = { authorization: `Bearer ${await tokenFor(userId, email)}` };
    const res = await call('/me');
    expect(res.status).toBe(200);
    const me = meResponseSchema.parse(await res.json());
    expect(me).toMatchObject({ id: userId, email, profileComplete: false, hasVehicle: false });
    expect(me.consent.required).toEqual(['age18', 'terms', 'privacy']);
  });

  it('profile, photo and vehicle are refused before consent', async () => {
    const res = await call('/me/profile', json('PATCH', { firstName: 'Ștefan' }));
    expect(res.status).toBe(403);
    expect((await errorOf(res)).code).toBe('CONSENT_REQUIRED');
    expect((await call('/me/vehicle')).status).toBe(403);
  });

  it('consent: stale versions are rejected, current ones accepted', async () => {
    const bad = await call(
      '/me/consents',
      json('POST', { age18: true, termsVersion: '0.1', privacyVersion: '1.0' }),
    );
    expect(bad.status).toBe(400);
    const ok = await call(
      '/me/consents',
      json('POST', { age18: true, termsVersion: '1.0', privacyVersion: '1.0' }),
    );
    expect(ok.status).toBe(204);
    const me = meResponseSchema.parse(await (await call('/me')).json());
    expect(me.consent).toEqual({ upToDate: true, required: [] });
  });

  it('profile: validates, normalises and stores diacritics', async () => {
    const bad = await call('/me/profile', json('PATCH', { phone: '0269 123 456' }));
    expect(bad.status).toBe(400);
    expect((await errorOf(bad)).fields).toHaveProperty('phone');
    const ok = await call(
      '/me/profile',
      json('PATCH', { firstName: 'Ștefan', phone: '0721 234 567', bio: 'Țepeș' }),
    );
    expect(ok.status).toBe(200);
    expect(meResponseSchema.parse(await ok.json())).toMatchObject({
      firstName: 'Ștefan',
      phoneE164: '+40721234567',
      bio: 'Țepeș',
      profileComplete: false, // no photo yet
    });
  });

  it('photo: rejects non-images, stores a re-encoded JPEG and completes the profile', async () => {
    const junk = new FormData();
    junk.set('photo', new File([new TextEncoder().encode('<html></html>')], 'x.jpg'));
    const rejected = await call('/me/photo', { method: 'PUT', body: junk });
    expect(rejected.status).toBe(400);
    expect((await errorOf(rejected)).code).toBe('PHOTO_INVALID');

    const img = new Image(64, 48);
    img.fill(Image.rgbToColor(30, 140, 90));
    const form = new FormData();
    form.set('photo', new File([(await img.encode()) as BlobPart], 'p.png', { type: 'image/png' }));
    const res = await call('/me/photo', { method: 'PUT', body: form });
    expect(res.status).toBe(200);
    const { photoUrl } = photoResponseSchema.parse(await res.json());
    const stored = await fetch(photoUrl);
    expect(stored.status).toBe(200);
    expect(stored.headers.get('content-type')).toContain('image/jpeg');
    const me = meResponseSchema.parse(await (await call('/me')).json());
    expect(me.profileComplete).toBe(true);
  });

  it('vehicle: 404 first, then PUT normalises the plate and GET returns it', async () => {
    expect((await call('/me/vehicle')).status).toBe(404);
    const put = await call(
      '/me/vehicle',
      json('PUT', {
        make: 'Dacia',
        model: 'Logan',
        colour: 'Gri',
        plate: 'sb 12 abc',
        fuelType: 'petrol',
        seats: 3,
      }),
    );
    expect(put.status).toBe(200);
    expect(vehicleResponseSchema.parse(await put.json()).plate).toBe('SB12ABC');
    expect(vehicleResponseSchema.parse(await (await call('/me/vehicle')).json()).seats).toBe(3);
    const bad = await call(
      '/me/vehicle',
      json('PUT', {
        make: 'Dacia',
        model: 'Logan',
        colour: 'Gri',
        plate: '!',
        fuelType: 'petrol',
        seats: 3,
      }),
    );
    expect(bad.status).toBe(400);
    expect(meResponseSchema.parse(await (await call('/me')).json()).hasVehicle).toBe(true);
  });

  it('public profile shows the name but never phone, plate or email', async () => {
    const res = await fetch(`${BASE}/users/${userId}`);
    expect(res.status).toBe(200);
    const body = publicUserSchema.parse(await res.json());
    expect(body).toMatchObject({ firstName: 'Ștefan', rating: null, ridesCompleted: 0 });
    const text = JSON.stringify(body);
    expect(text).not.toContain('+40');
    expect(text).not.toContain('SB12ABC');
    expect(text).not.toContain(email);
    expect((await fetch(`${BASE}/users/${crypto.randomUUID()}`)).status).toBe(404);
  });
});
