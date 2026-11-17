import { Hono } from 'hono';
import {
  consentBodySchema,
  PHOTO_FIELD,
  profilePatchBodySchema,
  vehicleBodySchema,
  type LegalCurrentResponse,
  type MeResponse,
  type PhotoResponse,
} from '../../_shared/contracts/account.ts';
import { isProfileComplete } from '../../_shared/domain/account.ts';
import { checkPhotoUpload } from '../../_shared/domain/photo.ts';
import {
  BODY_LIMIT_PHOTO_BYTES,
  PHOTO_MAX_BYTES,
  RATE_LIMITS,
  RELIABILITY_WINDOW_DAYS,
} from '../../_shared/domain/rules.ts';
import {
  normalizeBio,
  normalizeFirstName,
  normalizePhone,
  normalizePlate,
  normalizeVehicleText,
} from '../../_shared/domain/validation.ts';
import { AppError } from '../../_shared/errors.ts';
import { requireActive, requireConsent } from '../middleware/gates.ts';
import { rateLimit } from '../middleware/rateLimit.ts';
import {
  currentLegal,
  getPublicProfile,
  getVehicle,
  loadAccount,
  recordConsents,
  setPhotoPath,
  updateProfile,
  upsertVehicle,
  type ProfilePatchValues,
} from '../repo/accounts.ts';
import { toPublicUser } from '../serializers/users.ts';
import { avatarUrl } from '../services/storage.ts';
import type { Account, AppBindings, Deps } from '../types.ts';
import { parse, readJson } from '../validate.ts';

export const accountRoutes = new Hono<AppBindings>();

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DAY_MS = 86_400_000;

function toMe(a: Account, deps: Deps): MeResponse {
  return {
    id: a.id,
    email: a.email,
    firstName: a.firstName,
    phoneE164: a.phoneE164,
    bio: a.bio,
    photoUrl: avatarUrl(deps.env, a.photoPath),
    status: a.status,
    role: a.role,
    consent: {
      upToDate: a.consentRequired.length === 0,
      required: a.consentRequired,
      reaccept: a.consentReaccept,
    },
    profileComplete: isProfileComplete(a),
    hasVehicle: a.hasVehicle,
    createdAt: a.createdAt.toISOString(),
  };
}

// GET /legal/current: public
accountRoutes.get('/legal/current', rateLimit('legal', RATE_LIMITS.publicRead), async (c) => {
  const { versions, urls, publishedAt } = await currentLegal(
    c.get('deps').sql,
    c.get('deps').clock.now(),
  );
  const iso = (v: Date | string | undefined) => (v ? new Date(v).toISOString() : '');
  const body: LegalCurrentResponse = {
    terms: { version: versions.terms, url: urls.terms, publishedAt: iso(publishedAt.terms) },
    privacy: {
      version: versions.privacy,
      url: urls.privacy,
      publishedAt: iso(publishedAt.privacy),
    },
  };
  return c.json(body);
});

// GET /me
accountRoutes.get('/me', requireActive, (c) => c.json(toMe(c.get('account'), c.get('deps'))));

// POST /me/consents: terms and privacy at the current versions. age18 is required until it was given
// once; accepting updated terms does not ask for it again (E6).
accountRoutes.post(
  '/me/consents',
  requireActive,
  rateLimit('account', RATE_LIMITS.account),
  async (c) => {
    const { sql, clock } = c.get('deps');
    const body = parse(consentBodySchema, await readJson(c));
    const { versions } = await currentLegal(sql, clock.now());
    const fields: Record<string, string> = {};
    const needsAge18 = c.get('account').consentRequired.includes('age18');
    if (needsAge18 && body.age18 !== true) fields.age18 = 'required';
    if (body.termsVersion !== versions.terms) fields.termsVersion = 'not_current';
    if (body.privacyVersion !== versions.privacy) fields.privacyVersion = 'not_current';
    if (Object.keys(fields).length > 0) {
      throw new AppError('VALIDATION_FAILED', 'Accept the current document versions.', { fields });
    }
    await recordConsents(sql, c.get('account').id, versions, needsAge18);
    return c.body(null, 204);
  },
);

// PATCH /me/profile: any subset of firstName, phone, bio. Requires consent.
accountRoutes.patch(
  '/me/profile',
  requireConsent,
  rateLimit('account', RATE_LIMITS.account),
  async (c) => {
    const deps = c.get('deps');
    const body = parse(profilePatchBodySchema, await readJson(c));
    const values: ProfilePatchValues = {};
    const fields: Record<string, string> = {};
    const collect = (fn: () => void) => {
      try {
        fn();
      } catch (e) {
        const f = (e as { fields?: Record<string, string> }).fields;
        if (!f) throw e;
        Object.assign(fields, f);
      }
    };
    if (body.firstName !== undefined) {
      collect(() => (values.firstName = normalizeFirstName(body.firstName as string)));
    }
    if (body.phone !== undefined) {
      collect(() => (values.phone = normalizePhone(body.phone as string)));
    }
    if (body.bio !== undefined) collect(() => (values.bio = normalizeBio(body.bio ?? null)));
    if (Object.keys(fields).length > 0) {
      throw new AppError('VALIDATION_FAILED', 'Request validation failed.', { fields });
    }
    await updateProfile(deps.sql, c.get('account').id, values);
    const fresh = await loadAccount(
      deps.sql,
      c.get('account').id,
      c.get('account').email,
      deps.clock.now(),
    );
    return c.json(toMe(fresh, deps));
  },
);

// PUT /me/photo: multipart, field `photo`. Re-encoded to a 512x512 JPEG without metadata.
accountRoutes.put('/me/photo', requireConsent, rateLimit('photo', RATE_LIMITS.photo), async (c) => {
  const deps = c.get('deps');
  const contentType = (c.req.header('content-type') ?? '').toLowerCase();
  if (!contentType.startsWith('multipart/form-data')) {
    throw new AppError('VALIDATION_FAILED', 'Send multipart/form-data with a `photo` field.', {
      fields: { _: 'multipart_required' },
    });
  }
  if (Number(c.req.header('content-length') ?? 0) > BODY_LIMIT_PHOTO_BYTES) {
    throw new AppError('PHOTO_TOO_LARGE', 'Photo is larger than 1.5 MB.');
  }
  let form: FormData;
  try {
    form = await c.req.formData();
  } catch {
    throw new AppError('PHOTO_INVALID', 'Upload could not be read.');
  }
  const file = form.get(PHOTO_FIELD);
  if (!(file instanceof File)) {
    throw new AppError('PHOTO_INVALID', 'Missing `photo` file.', { fields: { photo: 'required' } });
  }
  if (file.size > PHOTO_MAX_BYTES) {
    throw new AppError('PHOTO_TOO_LARGE', 'Photo is larger than 1.5 MB.');
  }
  const bytes = new Uint8Array(await file.arrayBuffer());
  checkPhotoUpload(bytes);
  const jpeg = await deps.encodeAvatar(bytes);

  const path = `avatars/${crypto.randomUUID()}.jpg`;
  await deps.storage.upload(path, jpeg);
  let previous: string | null;
  try {
    previous = await setPhotoPath(deps.sql, c.get('account').id, path);
  } catch (err) {
    await deps.storage.remove(path);
    throw err;
  }
  if (previous && previous !== path) await deps.storage.remove(previous);
  const body: PhotoResponse = { photoUrl: avatarUrl(deps.env, path) as string };
  return c.json(body);
});

// GET /me/vehicle: 404 when there is none (owner only, includes the plate)
accountRoutes.get('/me/vehicle', requireConsent, async (c) => {
  const vehicle = await getVehicle(c.get('deps').sql, c.get('account').id);
  if (!vehicle) throw new AppError('NOT_FOUND', 'No vehicle yet.');
  return c.json(vehicle);
});

// PUT /me/vehicle: create or replace the single vehicle
accountRoutes.put(
  '/me/vehicle',
  requireConsent,
  rateLimit('account', RATE_LIMITS.account),
  async (c) => {
    const body = parse(vehicleBodySchema, await readJson(c));
    const fields: Record<string, string> = {};
    const attempt = <T>(fn: () => T, fallback: T): T => {
      try {
        return fn();
      } catch (e) {
        const f = (e as { fields?: Record<string, string> }).fields;
        if (!f) throw e;
        Object.assign(fields, f);
        return fallback;
      }
    };
    const normalised = {
      make: attempt(() => normalizeVehicleText('make', body.make), ''),
      model: attempt(() => normalizeVehicleText('model', body.model), ''),
      colour: attempt(() => normalizeVehicleText('colour', body.colour), ''),
      plate: attempt(() => normalizePlate(body.plate), ''),
      fuelType: body.fuelType,
      seats: body.seats,
    };
    if (Object.keys(fields).length > 0) {
      throw new AppError('VALIDATION_FAILED', 'Request validation failed.', { fields });
    }
    return c.json(await upsertVehicle(c.get('deps').sql, c.get('account').id, normalised));
  },
);

// GET /users/{id}: public. Never phone, plate or surname. Suspended users are a 404.
accountRoutes.get('/users/:id', rateLimit('users', RATE_LIMITS.publicRead), async (c) => {
  const { sql, clock, env } = c.get('deps');
  const id = c.req.param('id');
  if (!UUID_RE.test(id)) throw new AppError('NOT_FOUND', 'User not found.');
  const since = new Date(clock.now().getTime() - RELIABILITY_WINDOW_DAYS * DAY_MS);
  const row = await getPublicProfile(sql, id.toLowerCase(), since, clock.now());
  if (!row || row.status === 'suspended') throw new AppError('NOT_FOUND', 'User not found.');
  return c.json(toPublicUser(row, env));
});
