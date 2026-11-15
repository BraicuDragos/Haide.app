import { describe, expect, it } from 'vitest';
import { LOCAL_JWT_ISSUER, createTokenVerifier, resolveJwtIssuer } from './middleware/auth.ts';
import { TEST_JWT_SECRET, signToken, testEnv } from './testing.ts';

const USER = '3f0f4a2e-8d9c-4b1e-9a55-0c1d2e3f4a5b';

describe('resolveJwtIssuer', () => {
  it('uses the local stack issuer outside production', () => {
    expect(
      resolveJwtIssuer({ APP_ENV: 'local', SUPABASE_URL: undefined, JWT_ISSUER: undefined }),
    ).toBe(LOCAL_JWT_ISSUER);
    // inside the local edge runtime SUPABASE_URL is the internal gateway: it must NOT be used
    expect(
      resolveJwtIssuer({
        APP_ENV: 'local',
        SUPABASE_URL: 'http://kong:8000',
        JWT_ISSUER: undefined,
      }),
    ).toBe(LOCAL_JWT_ISSUER);
  });

  it('derives the issuer from SUPABASE_URL in production', () => {
    expect(
      resolveJwtIssuer({
        APP_ENV: 'production',
        SUPABASE_URL: 'https://abcd.supabase.co/',
        JWT_ISSUER: undefined,
      }),
    ).toBe('https://abcd.supabase.co/auth/v1');
  });

  it('lets JWT_ISSUER override everything', () => {
    expect(
      resolveJwtIssuer({
        APP_ENV: 'production',
        SUPABASE_URL: 'https://abcd.supabase.co',
        JWT_ISSUER: 'https://auth.example.com/auth/v1',
      }),
    ).toBe('https://auth.example.com/auth/v1');
  });
});

describe('token verifier', () => {
  const verify = createTokenVerifier(testEnv());

  it('accepts a token with the expected issuer and audience, and returns the email', async () => {
    const token = await signToken(USER, { email: 'a@example.com' });
    expect(await verify(token)).toEqual({ userId: USER, email: 'a@example.com' });
  });

  it('returns a null email when the claim is absent', async () => {
    expect(await verify(await signToken(USER))).toEqual({ userId: USER, email: null });
  });

  it('rejects a token from another issuer', async () => {
    const token = await signToken(USER, { iss: 'https://evil.example.com/auth/v1' });
    await expect(verify(token)).rejects.toThrow();
  });

  it('rejects a token without an issuer', async () => {
    const { SignJWT } = await import('jose');
    const token = await new SignJWT({})
      .setProtectedHeader({ alg: 'HS256' })
      .setSubject(USER)
      .setAudience('authenticated')
      .setExpirationTime('5m')
      .sign(new TextEncoder().encode(TEST_JWT_SECRET));
    await expect(verify(token)).rejects.toThrow();
  });

  it('rejects the wrong audience, a non-uuid subject and an expired token', async () => {
    await expect(verify(await signToken(USER, { aud: 'anon' }))).rejects.toThrow();
    await expect(verify(await signToken('not-a-uuid'))).rejects.toThrow();
    const { SignJWT } = await import('jose');
    const expired = await new SignJWT({})
      .setProtectedHeader({ alg: 'HS256' })
      .setSubject(USER)
      .setIssuer(LOCAL_JWT_ISSUER)
      .setAudience('authenticated')
      .setExpirationTime(Math.floor(Date.now() / 1000) - 60)
      .sign(new TextEncoder().encode(TEST_JWT_SECRET));
    await expect(verify(expired)).rejects.toThrow();
  });

  it('honours a custom JWT_ISSUER', async () => {
    const custom = createTokenVerifier(testEnv({ JWT_ISSUER: 'https://auth.example.com/auth/v1' }));
    await expect(custom(await signToken(USER))).rejects.toThrow(); // local issuer no longer matches
    const ok = await signToken(USER, { iss: 'https://auth.example.com/auth/v1' });
    expect((await custom(ok)).userId).toBe(USER);
  });

  it('refuses HS256 tokens in production', async () => {
    const prod = createTokenVerifier(
      testEnv({ APP_ENV: 'production', SUPABASE_URL: 'https://abcd.supabase.co' }),
    );
    await expect(
      prod(await signToken(USER, { iss: 'https://abcd.supabase.co/auth/v1' })),
    ).rejects.toThrow();
  });
});
