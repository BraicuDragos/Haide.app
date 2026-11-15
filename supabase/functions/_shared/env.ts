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
    EMAIL_SUPPORT_TO: z.string().default('support@haide.ro'),
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
  });

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
