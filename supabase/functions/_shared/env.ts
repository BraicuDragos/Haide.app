import { z } from 'zod';

const csv = (fallback: string) =>
  z
    .string()
    .default(fallback)
    .transform((s) =>
      s
        .split(',')
        .map((v) => v.trim())
        .filter(Boolean),
    );

/** Edge Function environment (deploy.md §4.2). Validated once at boot; failures stop the isolate. */
export const envSchema = z
  .object({
    APP_ENV: z.enum(['local', 'test', 'production']).default('local'),
    APP_VERSION: z.string().default('dev'),
    API_DB_URL: z.url({ protocol: /^postgres(ql)?$/ }),
    CRON_SECRET: z.string().min(16),
    ROUTING_PROVIDER: z.enum(['fixture', 'ors']).default('fixture'),
    ORS_API_KEY: z.string().optional(),
    EMAIL_PROVIDER: z.enum(['console', 'brevo']).default('console'),
    BREVO_API_KEY: z.string().optional(),
    EMAIL_FROM: z.string().default('Haide <no-reply@haide.ro>'),
    EMAIL_SUPPORT_TO: z.string().default('dragosbraicu9@gmail.com'),
    EMAIL_DAILY_CAP: z.coerce.number().int().positive().default(280),
    APP_BASE_URL: z.url().default('http://localhost:5173'),
    CORS_ORIGINS: csv('http://localhost:5173'),
    IP_HASH_SALT_SEED: z.string().min(16),
    // Injected by Supabase. SUPABASE_URL gives the JWKS endpoint for JWT verification.
    SUPABASE_URL: z.url().optional(),
    SUPABASE_SERVICE_ROLE_KEY: z.string().optional(),
    // Expected JWT `iss`. Default: <SUPABASE_URL>/auth/v1 in production, the local stack URL otherwise.
    JWT_ISSUER: z.url().optional(),
    // Browser-reachable storage base. Default: <SUPABASE_URL>/storage/v1/object/public.
    AVATAR_PUBLIC_BASE_URL: z.url().optional(),
    // Local development only: HS256 fallback when no JWKS is reachable. Ignored in production.
    LOCAL_JWT_SECRET: z.string().min(32).optional(),
    // E8 web push. All three or none (superRefine below). Generate with scripts/vapid-keys.mjs.
    // Public: base64url of the 65-byte uncompressed P-256 point. Private: base64url of the 32-byte scalar.
    VAPID_PUBLIC_KEY: z
      .string()
      .regex(/^[A-Za-z0-9_-]{87}$/)
      .optional(),
    VAPID_PRIVATE_KEY: z
      .string()
      .regex(/^[A-Za-z0-9_-]{43}$/)
      .optional(),
    VAPID_SUBJECT: z
      .string()
      .regex(/^(mailto:[^\s@]+@[^\s@]+|https:\/\/\S+)$/)
      .optional(),
    // Default: webpush when the keys are set, else console (which logs the host only).
    PUSH_PROVIDER: z.enum(['webpush', 'console']).optional(),
  })
  .superRefine((env, ctx) => {
    if (env.ROUTING_PROVIDER === 'ors' && !env.ORS_API_KEY) {
      ctx.addIssue({ code: 'custom', path: ['ORS_API_KEY'], message: 'required when ors' });
    }
    if (env.EMAIL_PROVIDER === 'brevo' && !env.BREVO_API_KEY) {
      ctx.addIssue({ code: 'custom', path: ['BREVO_API_KEY'], message: 'required when brevo' });
    }
    if (env.APP_ENV === 'production' && !env.SUPABASE_URL) {
      ctx.addIssue({ code: 'custom', path: ['SUPABASE_URL'], message: 'required in production' });
    }
    const vapid = [env.VAPID_PUBLIC_KEY, env.VAPID_PRIVATE_KEY, env.VAPID_SUBJECT];
    if (vapid.some((v) => v !== undefined) && vapid.some((v) => v === undefined)) {
      for (const [name, v] of [
        ['VAPID_PUBLIC_KEY', env.VAPID_PUBLIC_KEY],
        ['VAPID_PRIVATE_KEY', env.VAPID_PRIVATE_KEY],
        ['VAPID_SUBJECT', env.VAPID_SUBJECT],
      ] as const) {
        if (v === undefined) {
          ctx.addIssue({
            code: 'custom',
            path: [name],
            message: 'required when any VAPID value is set',
          });
        }
      }
    }
    if (env.PUSH_PROVIDER === 'webpush' && env.VAPID_PUBLIC_KEY === undefined) {
      ctx.addIssue({
        code: 'custom',
        path: ['VAPID_PUBLIC_KEY'],
        message: 'required when webpush',
      });
    }
  })
  .transform((env) => ({
    ...env,
    PUSH_PROVIDER:
      env.PUSH_PROVIDER ?? (env.VAPID_PUBLIC_KEY ? ('webpush' as const) : ('console' as const)),
  }));

export type Env = z.infer<typeof envSchema>;

/** Parse and validate. Throws one readable error listing every problem (names only, no values). */
export function parseEnv(source: Record<string, string | undefined>): Env {
  // Empty values (as in .env.example) count as "not set".
  const present = Object.fromEntries(
    Object.entries(source).filter(([, v]) => v !== undefined && v !== ''),
  );
  const result = envSchema.safeParse(present);
  if (!result.success) {
    const problems = result.error.issues
      .map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`)
      .join('; ');
    throw new Error(`Invalid environment: ${problems}`);
  }
  return result.data;
}
