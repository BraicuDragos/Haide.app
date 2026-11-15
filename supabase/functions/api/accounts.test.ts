import { Hono, type MiddlewareHandler } from 'hono';
import { describe, expect, it } from 'vitest';
import {
  legalCurrentResponseSchema,
  meResponseSchema,
  photoResponseSchema,
  publicUserSchema,
  vehicleResponseSchema,
} from '../_shared/contracts/account.ts';
import { errorEnvelopeSchema } from '../_shared/contracts/errors.ts';
import { DomainError } from '../_shared/domain/errors.ts';
import { fakeJpeg } from '../_shared/testing.ts';
import { authMiddleware } from './middleware/auth.ts';
import { onError } from './middleware/errors.ts';
import { requireActive, requireAdmin, requireProfile, requireVehicle } from './middleware/gates.ts';
import type { AppBindings } from './types.ts';
import { BASE, makeApp, signToken, type Handler, type Query } from './testing.ts';

const USER = '3f0f4a2e-8d9c-4b1e-9a55-0c1d2e3f4a5b';
const OTHER = '9a1b2c3d-4e5f-4a6b-8c7d-0e1f2a3b4c5d';

type State = {
  profile: Record<string, unknown> | null;
  accepted: { kind: string; version: string | null }[];
  legal: { kind: string; version: string; url: string }[];
  vehicle: Record<string, unknown> | null;
  public: Record<string, unknown> | null;
};

const profileRow = (over: Record<string, unknown> = {}) => ({
  id: USER,
  first_name: null,
  phone_e164: null,
  bio: null,
  photo_path: null,
  status: 'active',
  role: 'user',
  created_at: new Date('2026-10-01T10:00:00Z'),
  has_vehicle: false,
  ...over,
});

const ALL_ACCEPTED = [
  { kind: 'age_18', version: null },
  { kind: 'terms', version: '1.0' },
  { kind: 'privacy', version: '1.0' },
];

/** Stateful fake of the queries the account routes issue. Mutations update `state`. */
function accountDb(init: Partial<State> = {}) {
  const state: State = {
    profile: profileRow(),
    accepted: ALL_ACCEPTED,
    legal: [
      { kind: 'terms', version: '1.0', url: '/policy/terms' },
      { kind: 'privacy', version: '1.0', url: '/policy/privacy' },
    ],
    vehicle: null,
    public: null,
    ...init,
  };
  const writes: Query[] = [];
  const handler: Handler = (q) => {
    const t = q.text;
    if (t.includes('from app.legal_documents')) return state.legal;
    if (t.includes('has_vehicle')) return state.profile ? [state.profile] : [];
    if (t.includes('rating_count')) return state.public ? [state.public] : [];
    if (t.includes('from app.consents')) return state.accepted;
    if (t.startsWith('insert into app.profiles')) {
      state.profile = profileRow();
      writes.push(q);
      return [];
    }
    if (t.startsWith('insert into app.consents')) {
      writes.push(q);
      return [];
    }
    if (t.startsWith('update app.profiles set first_name')) {
      writes.push(q);
      const [fn, ph, bioSet, bio] = q.values as [
        string | null,
        string | null,
        boolean,
        string | null,
      ];
      state.profile = {
        ...state.profile,
        ...(fn ? { first_name: fn } : {}),
        ...(ph ? { phone_e164: ph } : {}),
        ...(bioSet ? { bio } : {}),
      };
      return [];
    }
    if (t.startsWith('update app.profiles p set photo_path')) {
      writes.push(q);
      const previous = (state.profile?.photo_path as string | null) ?? null;
      state.profile = { ...state.profile, photo_path: q.values[0] };
      return [{ previous }];
    }
    if (t.includes('from app.vehicles where owner_id')) return state.vehicle ? [state.vehicle] : [];
    if (t.startsWith('insert into app.vehicles')) {
      writes.push(q);
      const [, make, model, colour, plate, fuel_type, seats] = q.values;
      state.vehicle = { make, model, colour, plate, fuel_type, seats };
      return [state.vehicle];
    }
    return undefined;
  };
  return { state, writes, handler };
}

const auth = async (sub = USER, email = 'ioana@example.com') => ({
  authorization: `Bearer ${await signToken(sub, { email })}`,
});
const jsonReq = (method: string, body: unknown, headers: Record<string, string> = {}) => ({
  method,
  headers: { 'content-type': 'application/json', ...headers },
  body: JSON.stringify(body),
});
const errorCode = async (res: Response) => errorEnvelopeSchema.parse(await res.json()).error;

describe('GET /legal/current', () => {
  it('is public and returns the current versions with their urls', async () => {
    const { handler } = accountDb();
    const { app } = makeApp([handler]);
    const res = await app.request(`${BASE}/legal/current`);
    expect(res.status).toBe(200);
    expect(legalCurrentResponseSchema.parse(await res.json())).toEqual({
      terms: { version: '1.0', url: '/policy/terms' },
      privacy: { version: '1.0', url: '/policy/privacy' },
    });
  });

  it('is rate limited', async () => {
    const { app } = makeApp([
      (q) => (q.text.includes('rate_limit_hit') ? [{ allowed: false }] : undefined),
    ]);
    const res = await app.request(`${BASE}/legal/current`);
    expect(res.status).toBe(429);
  });
});

describe('GET /me', () => {
  it('answers 401 without a token', async () => {
    const { app } = makeApp([accountDb().handler]);
    const res = await app.request(`${BASE}/me`);
    expect(res.status).toBe(401);
    expect((await errorCode(res)).code).toBe('UNAUTHENTICATED');
  });

  it('answers 401 for a token signed with the wrong secret', async () => {
    const { app } = makeApp([accountDb().handler]);
    const bad = await signToken(USER, { secret: 'another-secret-with-at-least-32-characters!!' });
    const res = await app.request(`${BASE}/me`, { headers: { authorization: `Bearer ${bad}` } });
    expect(res.status).toBe(401);
  });

  it('returns a new user with everything outstanding', async () => {
    const { handler } = accountDb({ accepted: [] });
    const { app } = makeApp([handler]);
    const res = await app.request(`${BASE}/me`, { headers: await auth() });
    expect(res.status).toBe(200);
    expect(meResponseSchema.parse(await res.json())).toMatchObject({
      id: USER,
      email: 'ioana@example.com',
      firstName: null,
      status: 'active',
      role: 'user',
      consent: { upToDate: false, required: ['age18', 'terms', 'privacy'] },
      profileComplete: false,
      hasVehicle: false,
      photoUrl: null,
    });
  });

  it('returns a complete profile with the public photo url', async () => {
    const photo = 'avatars/6f1d8a5e-0000-4000-8000-000000000001.jpg';
    const { handler } = accountDb({
      profile: profileRow({
        first_name: 'Ștefan',
        phone_e164: '+40721234567',
        photo_path: photo,
        has_vehicle: true,
      }),
    });
    const { app } = makeApp([handler]);
    const body = meResponseSchema.parse(
      await (await app.request(`${BASE}/me`, { headers: await auth() })).json(),
    );
    expect(body).toMatchObject({
      firstName: 'Ștefan',
      phoneE164: '+40721234567',
      profileComplete: true,
      hasVehicle: true,
      consent: { upToDate: true, required: [] },
      createdAt: '2026-10-01T10:00:00.000Z',
    });
    expect(body.photoUrl).toBe(`http://127.0.0.1:54321/storage/v1/object/public/${photo}`);
  });

  it('honours AVATAR_PUBLIC_BASE_URL', async () => {
    const photo = 'avatars/6f1d8a5e-0000-4000-8000-000000000001.jpg';
    const { handler } = accountDb({ profile: profileRow({ photo_path: photo }) });
    const { app } = makeApp([handler], { AVATAR_PUBLIC_BASE_URL: 'https://cdn.example.com/p/' });
    const body = meResponseSchema.parse(
      await (await app.request(`${BASE}/me`, { headers: await auth() })).json(),
    );
    expect(body.photoUrl).toBe(`https://cdn.example.com/p/${photo}`);
  });

  it('creates a missing profile row on first sight (trigger lag, pre-migration users)', async () => {
    const { handler, writes } = accountDb({ profile: null });
    const { app } = makeApp([handler]);
    const res = await app.request(`${BASE}/me`, { headers: await auth() });
    expect(res.status).toBe(200);
    expect(writes.some((w) => w.text.startsWith('insert into app.profiles'))).toBe(true);
  });

  it('after a version bump reports the document that must be accepted again', async () => {
    const { handler } = accountDb({
      legal: [
        { kind: 'terms', version: '1.1', url: '/policy/terms' },
        { kind: 'privacy', version: '1.0', url: '/policy/privacy' },
      ],
    });
    const { app } = makeApp([handler]);
    const body = meResponseSchema.parse(
      await (await app.request(`${BASE}/me`, { headers: await auth() })).json(),
    );
    expect(body.consent).toEqual({ upToDate: false, required: ['terms'] });
  });

  it.each([
    ['suspended', 'ACCOUNT_SUSPENDED'],
    ['deleted', 'ACCOUNT_DELETED'],
  ])('answers 403 %s accounts with %s', async (status, code) => {
    const { handler } = accountDb({ profile: profileRow({ status }) });
    const { app } = makeApp([handler]);
    const res = await app.request(`${BASE}/me`, { headers: await auth() });
    expect(res.status).toBe(403);
    expect((await errorCode(res)).code).toBe(code);
  });
});

describe('POST /me/consents', () => {
  const body = { age18: true, termsVersion: '1.0', privacyVersion: '1.0' };

  it('writes three rows and answers 204', async () => {
    const { handler, writes } = accountDb({ accepted: [] });
    const { app } = makeApp([handler]);
    const res = await app.request(`${BASE}/me/consents`, jsonReq('POST', body, await auth()));
    expect(res.status).toBe(204);
    const insert = writes.find((w) => w.text.startsWith('insert into app.consents'));
    expect(insert?.text).toContain("'terms'");
    expect(insert?.text).toContain("'privacy'");
    expect(insert?.text).toContain("'age_18'");
    expect(insert?.values).toEqual([USER, '1.0', USER, '1.0', USER]);
  });

  it('requires a token', async () => {
    const { app } = makeApp([accountDb().handler]);
    const res = await app.request(`${BASE}/me/consents`, jsonReq('POST', body));
    expect(res.status).toBe(401);
  });

  it.each([
    ['age18 false', { ...body, age18: false }, 'age18'],
    ['age18 missing', { termsVersion: '1.0', privacyVersion: '1.0' }, 'age18'],
    ['terms version not current', { ...body, termsVersion: '0.9' }, 'termsVersion'],
    ['privacy version not current', { ...body, privacyVersion: '9.9' }, 'privacyVersion'],
    ['versions missing', { age18: true }, 'termsVersion'],
  ])('rejects %s with VALIDATION_FAILED', async (_n, payload, field) => {
    const { handler, writes } = accountDb({ accepted: [] });
    const { app } = makeApp([handler]);
    const res = await app.request(`${BASE}/me/consents`, jsonReq('POST', payload, await auth()));
    expect(res.status).toBe(400);
    const err = await errorCode(res);
    expect(err.code).toBe('VALIDATION_FAILED');
    expect(err.fields).toHaveProperty(field);
    expect(writes.some((w) => w.text.includes('consents'))).toBe(false);
  });

  it('rejects malformed JSON as VALIDATION_FAILED, not 500', async () => {
    const { app } = makeApp([accountDb().handler]);
    const res = await app.request(`${BASE}/me/consents`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...(await auth()) },
      body: '{nope',
    });
    expect(res.status).toBe(400);
    expect((await errorCode(res)).code).toBe('VALIDATION_FAILED');
  });

  it('rejects bodies over 64 KB', async () => {
    const { app } = makeApp([accountDb().handler]);
    const payload = JSON.stringify({ ...body, pad: 'x'.repeat(70_000) });
    const res = await app.request(`${BASE}/me/consents`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'content-length': String(new TextEncoder().encode(payload).length),
        ...(await auth()),
      },
      body: payload,
    });
    expect(res.status).toBe(400);
    expect(await errorCode(res)).toMatchObject({
      code: 'VALIDATION_FAILED',
      fields: { _: 'body_too_large' },
    });
  });
});

describe('PATCH /me/profile', () => {
  it('normalises name and phone and returns the /me shape', async () => {
    const { handler, writes } = accountDb();
    const { app } = makeApp([handler]);
    const res = await app.request(
      `${BASE}/me/profile`,
      jsonReq(
        'PATCH',
        { firstName: '  Ștefan ', phone: '0721 234 567', bio: ' Salut! ' },
        await auth(),
      ),
    );
    expect(res.status).toBe(200);
    expect(meResponseSchema.parse(await res.json())).toMatchObject({
      firstName: 'Ștefan',
      phoneE164: '+40721234567',
      bio: 'Salut!',
    });
    const update = writes.find((w) => w.text.startsWith('update app.profiles'));
    expect(update?.values.slice(0, 4)).toEqual(['Ștefan', '+40721234567', true, 'Salut!']);
  });

  it('updates a subset and leaves other fields untouched', async () => {
    const { handler, writes } = accountDb({
      profile: profileRow({ first_name: 'Ioana', bio: 'x' }),
    });
    const { app } = makeApp([handler]);
    const res = await app.request(
      `${BASE}/me/profile`,
      jsonReq('PATCH', { phone: '+40 721 234 567' }, await auth()),
    );
    expect(res.status).toBe(200);
    const update = writes.find((w) => w.text.startsWith('update app.profiles'));
    expect(update?.values.slice(0, 3)).toEqual([null, '+40721234567', false]);
  });

  it('clears the bio with null or an empty string', async () => {
    for (const bio of [null, '   ']) {
      const { handler, writes } = accountDb({ profile: profileRow({ bio: 'old' }) });
      const { app } = makeApp([handler]);
      const res = await app.request(`${BASE}/me/profile`, jsonReq('PATCH', { bio }, await auth()));
      expect(res.status).toBe(200);
      const update = writes.find((w) => w.text.startsWith('update app.profiles'));
      expect(update?.values.slice(2, 4)).toEqual([true, null]);
    }
  });

  it.each([
    ['empty body', {}, '_'],
    ['landline', { phone: '0269 123 456' }, 'phone'],
    ['foreign number', { phone: '+49 151 12345678' }, 'phone'],
    ['digits in name', { firstName: 'Ana2' }, 'firstName'],
    ['empty name', { firstName: '  ' }, 'firstName'],
    ['name over 30', { firstName: 'a'.repeat(31) }, 'firstName'],
    ['bio over 200', { bio: 'a'.repeat(201) }, 'bio'],
    ['wrong type', { firstName: 5 }, 'firstName'],
  ])('rejects %s', async (_n, payload, field) => {
    const { handler, writes } = accountDb();
    const { app } = makeApp([handler]);
    const res = await app.request(`${BASE}/me/profile`, jsonReq('PATCH', payload, await auth()));
    expect(res.status).toBe(400);
    const err = await errorCode(res);
    expect(err.code).toBe('VALIDATION_FAILED');
    expect(err.fields).toHaveProperty(field);
    expect(writes.some((w) => w.text.startsWith('update app.profiles'))).toBe(false);
  });

  it('reports every invalid field at once', async () => {
    const { app } = makeApp([accountDb().handler]);
    const res = await app.request(
      `${BASE}/me/profile`,
      jsonReq('PATCH', { firstName: '1', phone: '123' }, await auth()),
    );
    expect(Object.keys((await errorCode(res)).fields ?? {}).sort()).toEqual(['firstName', 'phone']);
  });

  it('answers CONSENT_REQUIRED after a version bump', async () => {
    const { handler, writes } = accountDb({
      legal: [
        { kind: 'terms', version: '2.0', url: '/policy/terms' },
        { kind: 'privacy', version: '1.0', url: '/policy/privacy' },
      ],
    });
    const { app } = makeApp([handler]);
    const res = await app.request(
      `${BASE}/me/profile`,
      jsonReq('PATCH', { firstName: 'Ana' }, await auth()),
    );
    expect(res.status).toBe(403);
    expect(await errorCode(res)).toMatchObject({
      code: 'CONSENT_REQUIRED',
      fields: { terms: 'required' },
    });
    expect(writes).toHaveLength(0);
  });

  it('answers 401 anonymously and 403 for suspended accounts', async () => {
    const { app } = makeApp([accountDb().handler]);
    expect((await app.request(`${BASE}/me/profile`, jsonReq('PATCH', { bio: 'x' }))).status).toBe(
      401,
    );
    const sus = makeApp([accountDb({ profile: profileRow({ status: 'suspended' }) }).handler]);
    const res = await sus.app.request(
      `${BASE}/me/profile`,
      jsonReq('PATCH', { bio: 'x' }, await auth()),
    );
    expect((await errorCode(res)).code).toBe('ACCOUNT_SUSPENDED');
  });
});

describe('PUT /me/photo', () => {
  const upload = async (bytes: Uint8Array, name = 'p.jpg', field = 'photo') => {
    const form = new FormData();
    form.set(field, new File([bytes as BlobPart], name, { type: 'image/jpeg' }));
    return { method: 'PUT', headers: await auth(), body: form };
  };

  it('stores the re-encoded image, saves the path and removes the previous object', async () => {
    const previous = 'avatars/11111111-1111-4111-8111-111111111111.jpg';
    const { handler, state } = accountDb({ profile: profileRow({ photo_path: previous }) });
    const encoded = Uint8Array.from([0xff, 0xd8, 0xff, 1, 2, 3]);
    const { app, uploaded, removed } = makeApp(
      [handler],
      {},
      { encodeAvatar: () => Promise.resolve(encoded) },
    );
    const res = await app.request(`${BASE}/me/photo`, await upload(fakeJpeg(800, 600)));
    expect(res.status).toBe(200);
    const { photoUrl } = photoResponseSchema.parse(await res.json());
    expect(uploaded).toHaveLength(1);
    expect(uploaded[0]?.path).toMatch(/^avatars\/[0-9a-f-]{36}\.jpg$/);
    expect(uploaded[0]?.bytes).toEqual(encoded); // the ENCODED bytes are stored, never the upload
    expect(photoUrl.endsWith(uploaded[0]?.path as string)).toBe(true);
    expect(state.profile?.photo_path).toBe(uploaded[0]?.path);
    expect(removed).toEqual([previous]);
  });

  it('does not remove anything on a first upload', async () => {
    const { handler } = accountDb();
    const { app, removed } = makeApp([handler]);
    expect((await app.request(`${BASE}/me/photo`, await upload(fakeJpeg(100, 100)))).status).toBe(
      200,
    );
    expect(removed).toEqual([]);
  });

  it('rejects files over 1.5 MB with PHOTO_TOO_LARGE', async () => {
    const big = new Uint8Array(1_572_864 + 10);
    big.set(fakeJpeg(100, 100));
    const { app, uploaded } = makeApp([accountDb().handler]);
    const res = await app.request(`${BASE}/me/photo`, await upload(big));
    expect(res.status).toBe(400);
    expect((await errorCode(res)).code).toBe('PHOTO_TOO_LARGE');
    expect(uploaded).toHaveLength(0);
  });

  it('rejects bodies far over the cap before reading them', async () => {
    const { app } = makeApp([accountDb().handler]);
    const res = await app.request(`${BASE}/me/photo`, {
      method: 'PUT',
      headers: {
        ...(await auth()),
        'content-type': 'multipart/form-data; boundary=x',
        'content-length': '5000000',
      },
      body: 'x',
    });
    expect((await errorCode(res)).code).toBe('PHOTO_TOO_LARGE');
  });

  it.each([
    ['not an image (HTML named .jpg)', new TextEncoder().encode('<html>x</html>')],
    ['GIF', Uint8Array.from([0x47, 0x49, 0x46, 0x38, 0x39, 0x61, 0, 0, 0, 0])],
    ['empty file', new Uint8Array(0)],
  ])('rejects %s with PHOTO_INVALID', async (_n, bytes) => {
    const { app, uploaded } = makeApp([accountDb().handler]);
    const res = await app.request(`${BASE}/me/photo`, await upload(bytes));
    expect(res.status).toBe(400);
    expect((await errorCode(res)).code).toBe('PHOTO_INVALID');
    expect(uploaded).toHaveLength(0);
  });

  it('rejects a missing photo field and a non-multipart body', async () => {
    const { app } = makeApp([accountDb().handler]);
    const wrongField = await app.request(
      `${BASE}/me/photo`,
      await upload(fakeJpeg(10, 10), 'p.jpg', 'file'),
    );
    expect((await errorCode(wrongField)).code).toBe('PHOTO_INVALID');
    const json = await app.request(`${BASE}/me/photo`, jsonReq('PUT', {}, await auth()));
    expect((await errorCode(json)).code).toBe('VALIDATION_FAILED');
  });

  it('turns an undecodable image into PHOTO_INVALID without storing anything', async () => {
    const { app, uploaded } = makeApp(
      [accountDb().handler],
      {},
      {
        encodeAvatar: () =>
          Promise.reject(new DomainError('PHOTO_INVALID', 'Photo could not be decoded.')),
      },
    );
    const res = await app.request(`${BASE}/me/photo`, await upload(fakeJpeg(10, 10)));
    expect(res.status).toBe(400);
    expect((await errorCode(res)).code).toBe('PHOTO_INVALID');
    expect(uploaded).toHaveLength(0);
  });

  it('removes the new object when saving the path fails', async () => {
    const { handler } = accountDb();
    const failing: Handler = (q) => {
      if (q.text.startsWith('update app.profiles p set photo_path')) throw new Error('db down');
      return handler(q);
    };
    const { app, uploaded, removed } = makeApp([failing]);
    const res = await app.request(`${BASE}/me/photo`, await upload(fakeJpeg(100, 100)));
    expect(res.status).toBe(500);
    expect(removed).toEqual([uploaded[0]?.path]);
  });

  it('requires auth and consent', async () => {
    const anon = makeApp([accountDb().handler]);
    const form = new FormData();
    form.set('photo', new File([fakeJpeg(10, 10) as BlobPart], 'p.jpg'));
    expect((await anon.app.request(`${BASE}/me/photo`, { method: 'PUT', body: form })).status).toBe(
      401,
    );
    const { handler } = accountDb({ accepted: [] });
    const res = await makeApp([handler]).app.request(
      `${BASE}/me/photo`,
      await upload(fakeJpeg(10, 10)),
    );
    expect((await errorCode(res)).code).toBe('CONSENT_REQUIRED');
  });
});

describe('GET|PUT /me/vehicle', () => {
  const vehicle = {
    make: 'Dacia',
    model: 'Logan',
    colour: 'Grey',
    plate: 'sb 12 abc',
    fuelType: 'petrol',
    seats: 3,
  };

  it('GET answers 404 when there is no vehicle', async () => {
    const { app } = makeApp([accountDb().handler]);
    const res = await app.request(`${BASE}/me/vehicle`, { headers: await auth() });
    expect(res.status).toBe(404);
    expect((await errorCode(res)).code).toBe('NOT_FOUND');
  });

  it('PUT normalises the plate and GET returns it (owner view)', async () => {
    const { handler, writes } = accountDb();
    const { app } = makeApp([handler]);
    const put = await app.request(`${BASE}/me/vehicle`, jsonReq('PUT', vehicle, await auth()));
    expect(put.status).toBe(200);
    expect(vehicleResponseSchema.parse(await put.json())).toEqual({
      make: 'Dacia',
      model: 'Logan',
      colour: 'Grey',
      plate: 'SB12ABC',
      fuelType: 'petrol',
      seats: 3,
    });
    expect(writes.find((w) => w.text.startsWith('insert into app.vehicles'))?.values[4]).toBe(
      'SB12ABC',
    );
    const get = await app.request(`${BASE}/me/vehicle`, { headers: await auth() });
    expect(get.status).toBe(200);
    expect(vehicleResponseSchema.parse(await get.json()).plate).toBe('SB12ABC');
  });

  it('PUT replaces an existing vehicle (upsert, one per user)', async () => {
    const { handler, writes } = accountDb();
    const { app } = makeApp([handler]);
    await app.request(`${BASE}/me/vehicle`, jsonReq('PUT', vehicle, await auth()));
    const res = await app.request(
      `${BASE}/me/vehicle`,
      jsonReq('PUT', { ...vehicle, model: 'Sandero', seats: 4 }, await auth()),
    );
    expect(res.status).toBe(200);
    expect(writes.at(-1)?.text).toContain('on conflict (owner_id) do update');
    expect((await res.json()) as unknown).toMatchObject({ model: 'Sandero', seats: 4 });
  });

  it.each([
    ['bad plate', { plate: 'x' }, 'plate'],
    ['plate with diacritics', { plate: 'SB 12 ĂBC' }, 'plate'],
    ['empty make', { make: ' ' }, 'make'],
    ['model over 30', { model: 'm'.repeat(31) }, 'model'],
    ['unknown fuel', { fuelType: 'steam' }, 'fuelType'],
    ['0 seats', { seats: 0 }, 'seats'],
    ['5 seats', { seats: 5 }, 'seats'],
    ['fractional seats', { seats: 2.5 }, 'seats'],
  ])('PUT rejects %s', async (_n, patch, field) => {
    const { handler, writes } = accountDb();
    const { app } = makeApp([handler]);
    const res = await app.request(
      `${BASE}/me/vehicle`,
      jsonReq('PUT', { ...vehicle, ...patch }, await auth()),
    );
    expect(res.status).toBe(400);
    const err = await errorCode(res);
    expect(err.code).toBe('VALIDATION_FAILED');
    expect(err.fields).toHaveProperty(field);
    expect(writes.some((w) => w.text.startsWith('insert into app.vehicles'))).toBe(false);
  });

  it('PUT rejects a missing field', async () => {
    const { app } = makeApp([accountDb().handler]);
    const { make: _make, ...rest } = vehicle;
    const res = await app.request(`${BASE}/me/vehicle`, jsonReq('PUT', rest, await auth()));
    expect((await errorCode(res)).fields).toHaveProperty('make');
  });

  it('requires auth and consent', async () => {
    expect((await makeApp([accountDb().handler]).app.request(`${BASE}/me/vehicle`)).status).toBe(
      401,
    );
    const { handler } = accountDb({ accepted: [] });
    const res = await makeApp([handler]).app.request(
      `${BASE}/me/vehicle`,
      jsonReq('PUT', vehicle, await auth()),
    );
    expect((await errorCode(res)).code).toBe('CONSENT_REQUIRED');
  });
});

describe('GET /users/{id}', () => {
  const row = (over: Record<string, unknown> = {}) => ({
    id: OTHER,
    first_name: 'Radu',
    bio: 'Merg zilnic spre Cisnădie',
    photo_path: 'avatars/22222222-2222-4222-8222-222222222222.jpg',
    status: 'active',
    created_at: new Date('2026-09-20T08:00:00Z'),
    rating_count: 23,
    rating_avg: 4.8261,
    late_cancellations: 1,
    no_shows: 0,
    ...over,
  });

  it('is public and never exposes phone, plate or surname', async () => {
    const { handler } = accountDb({ public: row() });
    const { app, calls } = makeApp([handler]);
    const res = await app.request(`${BASE}/users/${OTHER}`);
    expect(res.status).toBe(200);
    const body = publicUserSchema.parse(await res.json());
    expect(body).toMatchObject({
      id: OTHER,
      firstName: 'Radu',
      memberSince: '2026-09',
      rating: { average: 4.8, count: 23 },
      lateCancellations90d: 1,
      noShows90d: 0,
      bio: 'Merg zilnic spre Cisnădie',
    });
    const text = JSON.stringify(body).toLowerCase();
    for (const forbidden of ['phone', 'plate', 'surname', 'lastname', 'email', '+40']) {
      expect(text).not.toContain(forbidden);
    }
    // the query itself never selects phone or plate
    const q = calls.find((c) => c.text.includes('rating_count'))?.text ?? '';
    expect(q).not.toContain('phone_e164');
    expect(q).not.toContain('plate');
  });

  it('shows "New" (null rating) under 3 ratings', async () => {
    const { handler } = accountDb({ public: row({ rating_count: 2, rating_avg: 5 }) });
    const body = publicUserSchema.parse(
      await (await makeApp([handler]).app.request(`${BASE}/users/${OTHER}`)).json(),
    );
    expect(body.rating).toBeNull();
  });

  it('shows the rating from exactly 3 seeded ratings', async () => {
    const { handler } = accountDb({ public: row({ rating_count: 3, rating_avg: 4.3333 }) });
    const body = publicUserSchema.parse(
      await (await makeApp([handler]).app.request(`${BASE}/users/${OTHER}`)).json(),
    );
    expect(body.rating).toEqual({ average: 4.3, count: 3 });
  });

  it('passes the 90-day window to the counters', async () => {
    const { handler } = accountDb({ public: row() });
    const { app, calls } = makeApp([handler]);
    await app.request(`${BASE}/users/${OTHER}`);
    const since = calls
      .find((c) => c.text.includes('rating_count'))
      ?.values.find((v) => v instanceof Date) as Date;
    expect(since.toISOString()).toBe('2026-08-18T05:00:00.000Z'); // clock 2026-11-16T05:00Z minus 90 days
  });

  it('renders a deleted user without name, photo or bio', async () => {
    const { handler } = accountDb({ public: row({ status: 'deleted', first_name: null }) });
    const body = publicUserSchema.parse(
      await (await makeApp([handler]).app.request(`${BASE}/users/${OTHER}`)).json(),
    );
    expect(body).toMatchObject({ firstName: null, photoUrl: null, bio: null });
  });

  it('answers 404 for suspended, unknown and malformed ids', async () => {
    const sus = makeApp([accountDb({ public: row({ status: 'suspended' }) }).handler]);
    expect((await sus.app.request(`${BASE}/users/${OTHER}`)).status).toBe(404);
    const none = makeApp([accountDb({ public: null }).handler]);
    expect((await none.app.request(`${BASE}/users/${OTHER}`)).status).toBe(404);
    expect((await none.app.request(`${BASE}/users/not-a-uuid`)).status).toBe(404);
  });
});

describe('gates', () => {
  // A throw-away app that mounts the strictest gates, as E2+ routes will.
  function gated(handler: Handler, ...gates: MiddlewareHandler<AppBindings>[]) {
    const base = makeApp([handler]);
    const app = new Hono<AppBindings>();
    app.use('*', async (c, next) => {
      c.set('deps', base.deps);
      await next();
    });
    app.use('*', authMiddleware);
    for (const g of gates) app.use('/x', g);
    app.get('/x', (c) => c.json({ ok: true }));
    app.onError(onError);
    return app;
  }
  const complete = {
    first_name: 'Ioana',
    phone_e164: '+40721234567',
    photo_path: 'avatars/33333333-3333-4333-8333-333333333333.jpg',
  };

  it('requireProfile answers PROFILE_INCOMPLETE until name, phone and photo exist', async () => {
    const incomplete = gated(accountDb().handler, requireProfile);
    const res = await incomplete.request('http://localhost/x', { headers: await auth() });
    expect(res.status).toBe(403);
    expect((await errorCode(res)).code).toBe('PROFILE_INCOMPLETE');

    const done = gated(accountDb({ profile: profileRow(complete) }).handler, requireProfile);
    expect((await done.request('http://localhost/x', { headers: await auth() })).status).toBe(200);
  });

  it('requireVehicle answers VEHICLE_REQUIRED only after the profile gate passes', async () => {
    const noProfile = gated(accountDb().handler, requireVehicle);
    expect(
      (await errorCode(await noProfile.request('http://localhost/x', { headers: await auth() })))
        .code,
    ).toBe('PROFILE_INCOMPLETE');

    const noCar = gated(accountDb({ profile: profileRow(complete) }).handler, requireVehicle);
    expect(
      (await errorCode(await noCar.request('http://localhost/x', { headers: await auth() }))).code,
    ).toBe('VEHICLE_REQUIRED');

    const car = gated(
      accountDb({ profile: profileRow({ ...complete, has_vehicle: true }) }).handler,
      requireVehicle,
    );
    expect((await car.request('http://localhost/x', { headers: await auth() })).status).toBe(200);
  });

  it('consent is checked before profile completeness', async () => {
    const app = gated(accountDb({ accepted: [] }).handler, requireProfile);
    expect(
      (await errorCode(await app.request('http://localhost/x', { headers: await auth() }))).code,
    ).toBe('CONSENT_REQUIRED');
  });

  it('requireActive blocks suspended accounts before anything else', async () => {
    const app = gated(
      accountDb({ profile: profileRow({ status: 'suspended' }), accepted: [] }).handler,
      requireProfile,
    );
    expect(
      (await errorCode(await app.request('http://localhost/x', { headers: await auth() }))).code,
    ).toBe('ACCOUNT_SUSPENDED');
  });

  it('requireAdmin answers FORBIDDEN for users and passes admins', async () => {
    const user = gated(accountDb().handler, requireAdmin);
    const res = await user.request('http://localhost/x', { headers: await auth() });
    expect(res.status).toBe(403);
    expect((await errorCode(res)).code).toBe('FORBIDDEN');
    const admin = gated(
      accountDb({ profile: profileRow({ role: 'admin' }) }).handler,
      requireAdmin,
    );
    expect((await admin.request('http://localhost/x', { headers: await auth() })).status).toBe(200);
  });

  it('every gate answers 401 anonymously', async () => {
    for (const gate of [requireActive, requireProfile, requireVehicle, requireAdmin]) {
      const app = gated(accountDb().handler, gate);
      expect((await app.request('http://localhost/x')).status).toBe(401);
    }
  });

  it('loads the account once per request however many gates run', async () => {
    const { handler } = accountDb({ profile: profileRow({ ...complete, has_vehicle: true }) });
    let selects = 0;
    const counting: Handler = (q) => {
      if (q.text.includes('has_vehicle')) selects += 1;
      return handler(q);
    };
    const app = gated(counting, requireActive, requireVehicle);
    expect((await app.request('http://localhost/x', { headers: await auth() })).status).toBe(200);
    expect(selects).toBe(1);
  });
});
