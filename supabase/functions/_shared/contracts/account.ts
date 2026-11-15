import { z } from 'zod';

/**
 * Account contracts (E1): /legal/current, /me, /me/consents, /me/profile, /me/photo, /me/vehicle,
 * /users/{id}. Shared with the web app (import through @contracts). STABLE: additive changes only.
 */

// ---- Shared field rules (the server re-validates and normalises every one of them) ----------

/**
 * Unicode letters and combining marks, space, hyphen, apostrophe (straight or typographic); starts
 * with a letter; 1-30 chars (data-model 4.1). Keep in step with NAME_RE in apps/web/src/lib/validation.ts.
 */
export const FIRST_NAME_PATTERN = /^\p{L}[\p{L}\p{M} '’-]{0,29}$/u;
export const BIO_MAX = 200;
export const VEHICLE_TEXT_MAX = 30;
export const PHOTO_MAX_BYTES = 1_572_864; // 1.5 MiB, after client-side resize
export const PHOTO_FIELD = 'photo';

export const fuelTypeSchema = z.enum(['petrol', 'diesel', 'lpg', 'hybrid', 'electric']);
export type FuelType = z.infer<typeof fuelTypeSchema>;

export const profileStatusSchema = z.enum(['active', 'suspended', 'deleted']);
export const userRoleSchema = z.enum(['user', 'admin']);

/** What a user still has to accept. Order: age18, terms, privacy. */
export const consentRequiredSchema = z.enum(['age18', 'terms', 'privacy']);
export type ConsentRequired = z.infer<typeof consentRequiredSchema>;

// ---- GET /legal/current (public) -----------------------------------------------------------

const legalDocSchema = z.object({ version: z.string(), url: z.string() });
export const legalCurrentResponseSchema = z.object({
  terms: legalDocSchema,
  privacy: legalDocSchema,
});
export type LegalCurrentResponse = z.infer<typeof legalCurrentResponseSchema>;

// ---- GET /me, PATCH /me/profile (200 returns the /me shape) ---------------------------------

export const meResponseSchema = z.object({
  id: z.uuid(),
  email: z.string().nullable(),
  firstName: z.string().nullable(),
  phoneE164: z.string().nullable(),
  bio: z.string().nullable(),
  photoUrl: z.string().nullable(),
  status: profileStatusSchema,
  role: userRoleSchema,
  consent: z.object({ upToDate: z.boolean(), required: z.array(consentRequiredSchema) }),
  profileComplete: z.boolean(),
  hasVehicle: z.boolean(),
  createdAt: z.string(),
});
export type MeResponse = z.infer<typeof meResponseSchema>;

// ---- POST /me/consents (204) ----------------------------------------------------------------

export const consentBodySchema = z.object({
  age18: z.literal(true),
  termsVersion: z.string().min(1).max(20),
  privacyVersion: z.string().min(1).max(20),
});
export type ConsentBody = z.infer<typeof consentBodySchema>;

// ---- PATCH /me/profile: any non-empty subset ---------------------------------------------------
// The shapes here are deliberately loose (strings with a length cap): the server normalises
// (trim, NFC, phone to E.164) and answers VALIDATION_FAILED with `fields` for the rules.

export const profilePatchBodySchema = z
  .object({
    firstName: z.string().max(60),
    phone: z.string().max(40),
    bio: z.string().max(400).nullable(),
  })
  .partial()
  .refine((v) => Object.keys(v).length > 0, { message: 'empty_patch' });
export type ProfilePatchBody = z.infer<typeof profilePatchBodySchema>;

// ---- PUT /me/photo: multipart/form-data, field `photo` -----------------------------------------

export const photoResponseSchema = z.object({ photoUrl: z.string() });
export type PhotoResponse = z.infer<typeof photoResponseSchema>;

// ---- GET|PUT /me/vehicle ----------------------------------------------------------------------

export const vehicleBodySchema = z.object({
  make: z.string().max(60),
  model: z.string().max(60),
  colour: z.string().max(60),
  plate: z.string().max(20),
  fuelType: fuelTypeSchema,
  seats: z.number().int().min(1).max(4),
});
export type VehicleBody = z.infer<typeof vehicleBodySchema>;

/** Owner-only view: includes the plate (normalised, uppercase, no spaces). */
export const vehicleResponseSchema = vehicleBodySchema;
export type VehicleResponse = z.infer<typeof vehicleResponseSchema>;

// ---- GET /users/{id} (public) ------------------------------------------------------------------
// Never contains phone, plate or surname. firstName null = deleted user.

export const publicUserSchema = z.object({
  id: z.uuid(),
  firstName: z.string().nullable(),
  photoUrl: z.string().nullable(),
  memberSince: z.string().regex(/^\d{4}-\d{2}$/),
  rating: z.object({ average: z.number(), count: z.number().int() }).nullable(),
  ridesCompleted: z.number().int(),
  lateCancellations90d: z.number().int(),
  noShows90d: z.number().int(),
  bio: z.string().nullable(),
});
export type PublicUser = z.infer<typeof publicUserSchema>;
