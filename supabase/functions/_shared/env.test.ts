import { describe, expect, it } from 'vitest';
import { parseEnv } from './env.ts';

const base = {
  API_DB_URL: 'postgresql://haide_api:pw@127.0.0.1:54322/postgres',
  CRON_SECRET: 'cron-secret-0123456789',
  IP_HASH_SALT_SEED: 'salt-seed-0123456789',
};

describe('parseEnv', () => {
  it('applies safe local defaults', () => {
    const env = parseEnv(base);
    expect(env.APP_ENV).toBe('local');
    expect(env.ROUTING_PROVIDER).toBe('fixture');
    expect(env.EMAIL_PROVIDER).toBe('console');
    expect(env.EMAIL_DAILY_CAP).toBe(280);
    expect(env.EMAIL_SUPPORT_TO).toBe('dragosbraicu9@gmail.com');
    expect(env.CORS_ORIGINS).toEqual(['http://localhost:5173']);
  });

  it('splits CORS_ORIGINS and coerces numbers', () => {
    const env = parseEnv({
      ...base,
      CORS_ORIGINS: 'https://haide.ro, https://www.haide.ro,',
      EMAIL_DAILY_CAP: '250',
    });
    expect(env.CORS_ORIGINS).toEqual(['https://haide.ro', 'https://www.haide.ro']);
    expect(env.EMAIL_DAILY_CAP).toBe(250);
  });

  it('lists every problem by name and never echoes values', () => {
    let message = '';
    try {
      parseEnv({ CRON_SECRET: 'short-value' });
    } catch (e) {
      message = String(e);
    }
    expect(message).toContain('API_DB_URL');
    expect(message).toContain('CRON_SECRET');
    expect(message).toContain('IP_HASH_SALT_SEED');
    expect(message).not.toContain('short-value');
  });

  it('requires provider keys for real providers and the Supabase URL in production', () => {
    expect(() => parseEnv({ ...base, ROUTING_PROVIDER: 'ors' })).toThrow(/ORS_API_KEY/);
    expect(() => parseEnv({ ...base, EMAIL_PROVIDER: 'brevo' })).toThrow(/BREVO_API_KEY/);
    expect(() => parseEnv({ ...base, APP_ENV: 'production' })).toThrow(/SUPABASE_URL/);
    expect(
      parseEnv({ ...base, APP_ENV: 'production', SUPABASE_URL: 'https://x.supabase.co' }).APP_ENV,
    ).toBe('production');
  });

  it('treats empty values like unset ones (as copied from .env.example)', () => {
    const env = parseEnv({ ...base, SUPABASE_URL: '', LOCAL_JWT_SECRET: '', ORS_API_KEY: '' });
    expect(env.SUPABASE_URL).toBeUndefined();
    expect(env.LOCAL_JWT_SECRET).toBeUndefined();
  });

  it('rejects non-postgres database URLs', () => {
    expect(() => parseEnv({ ...base, API_DB_URL: 'https://example.com' })).toThrow(/API_DB_URL/);
  });
});

describe('parseEnv, web push (E8)', () => {
  const keys = {
    VAPID_PUBLIC_KEY: `B${'c'.repeat(86)}`,
    VAPID_PRIVATE_KEY: 'd'.repeat(43),
    VAPID_SUBJECT: 'mailto:support@haide.ro',
  };

  it('push is off by default: no keys, console provider', () => {
    const env = parseEnv(base);
    expect(env.VAPID_PUBLIC_KEY).toBeUndefined();
    expect(env.PUSH_PROVIDER).toBe('console');
  });

  it('all three keys set: webpush by default, console on request', () => {
    expect(parseEnv({ ...base, ...keys }).PUSH_PROVIDER).toBe('webpush');
    expect(parseEnv({ ...base, ...keys, PUSH_PROVIDER: 'console' }).PUSH_PROVIDER).toBe('console');
    expect(
      parseEnv({ ...base, ...keys, VAPID_SUBJECT: 'https://haide.ro/contact' }).VAPID_SUBJECT,
    ).toBe('https://haide.ro/contact');
  });

  it('all or none: a partial set is a boot error naming the missing values, never their values', () => {
    expect(() => parseEnv({ ...base, VAPID_PUBLIC_KEY: keys.VAPID_PUBLIC_KEY })).toThrow(
      /VAPID_PRIVATE_KEY.*VAPID_SUBJECT/,
    );
    try {
      parseEnv({ ...base, VAPID_PUBLIC_KEY: keys.VAPID_PUBLIC_KEY });
    } catch (e) {
      expect(String(e)).not.toContain(keys.VAPID_PUBLIC_KEY);
    }
  });

  it('refuses malformed keys and subjects, and webpush without keys', () => {
    expect(() => parseEnv({ ...base, ...keys, VAPID_PUBLIC_KEY: 'short' })).toThrow();
    expect(() => parseEnv({ ...base, ...keys, VAPID_SUBJECT: 'support@haide.ro' })).toThrow();
    expect(() => parseEnv({ ...base, PUSH_PROVIDER: 'webpush' })).toThrow(/VAPID_PUBLIC_KEY/);
  });
});
