import { describe, expect, it } from 'vitest';
import { silentLogger } from '../../log.ts';
import { BREVO_URL, classifyStatus, createBrevoProvider, parseSender } from './brevo.ts';
import { createConsoleProvider } from './console.ts';
import { createEmailProvider } from './index.ts';

const msg = {
  to: 'ioana@example.com',
  subject: 'Hello',
  text: 'Plain',
  html: '<p>Plain</p>',
  tag: 'booking_requested',
  ref: 'abc123def456',
};

describe('classifyStatus', () => {
  it('2xx ok, 429 and 5xx transient, other 4xx permanent', () => {
    expect(classifyStatus(201)).toBe('ok');
    expect(classifyStatus(429)).toBe('transient');
    expect(classifyStatus(500)).toBe('transient');
    expect(classifyStatus(503)).toBe('transient');
    expect(classifyStatus(400)).toBe('permanent');
    expect(classifyStatus(401)).toBe('permanent');
    expect(classifyStatus(404)).toBe('permanent');
  });
});

describe('parseSender', () => {
  it('splits a display name and an address', () => {
    expect(parseSender('Haide <no-reply@haide.ro>')).toEqual({
      name: 'Haide',
      email: 'no-reply@haide.ro',
    });
    expect(parseSender('no-reply@haide.ro')).toEqual({ email: 'no-reply@haide.ro' });
  });
});

describe('Brevo provider', () => {
  it('posts to the transactional endpoint with the api-key header', async () => {
    const seen: { url: string; init: RequestInit }[] = [];
    const provider = createBrevoProvider({
      apiKey: 'k-123',
      from: 'Haide <no-reply@haide.ro>',
      fetchImpl: ((url: string, init: RequestInit) => {
        seen.push({ url, init });
        return Promise.resolve(new Response('{"messageId":"x"}', { status: 201 }));
      }) as unknown as typeof fetch,
    });
    expect(await provider.send(msg)).toEqual({ ok: true, messageId: 'x' });
    const call = seen[0] as { url: string; init: RequestInit };
    expect(call.url).toBe(BREVO_URL);
    expect((call.init.headers as Record<string, string>)['api-key']).toBe('k-123');
    expect(JSON.parse(String(call.init.body))).toMatchObject({
      sender: { name: 'Haide', email: 'no-reply@haide.ro' },
      to: [{ email: 'ioana@example.com' }],
      subject: 'Hello',
      textContent: 'Plain',
      tags: ['booking_requested'],
    });
    expect(call.init.signal).toBeInstanceOf(AbortSignal);
  });

  const capturing = (replyTo?: string, body = '{"messageId":"<m1>"}') => {
    const bodies: Record<string, unknown>[] = [];
    const provider = createBrevoProvider({
      apiKey: 'k',
      from: 'Haide <no-reply@haide.ro>',
      replyTo,
      fetchImpl: ((_u: string, init: RequestInit) => {
        bodies.push(JSON.parse(String(init.body)) as Record<string, unknown>);
        return Promise.resolve(new Response(body, { status: 201 }));
      }) as unknown as typeof fetch,
    });
    return { provider, bodies };
  };

  it('sends no replyTo unless EMAIL_REPLY_TO is set', async () => {
    const a = capturing();
    await a.provider.send(msg);
    expect(a.bodies[0]).not.toHaveProperty('replyTo');
    const blank = capturing('   ');
    await blank.provider.send(msg);
    expect(blank.bodies[0]).not.toHaveProperty('replyTo');
  });

  it('sends replyTo with a name, or a bare address', async () => {
    const named = capturing('Haide Support <support@haide.ro>');
    await named.provider.send(msg);
    expect(named.bodies[0]?.replyTo).toEqual({ name: 'Haide Support', email: 'support@haide.ro' });
    const bare = capturing('support@haide.ro');
    await bare.provider.send(msg);
    expect(bare.bodies[0]?.replyTo).toEqual({ email: 'support@haide.ro' });
    // the sender is untouched: EMAIL_FROM stays the single sender variable
    expect(bare.bodies[0]?.sender).toEqual({ name: 'Haide', email: 'no-reply@haide.ro' });
  });

  it('returns the messageId, and still succeeds when the body is empty or not JSON', async () => {
    expect(await capturing().provider.send(msg)).toEqual({ ok: true, messageId: '<m1>' });
    expect(await capturing(undefined, '').provider.send(msg)).toEqual({ ok: true });
    expect(await capturing(undefined, 'not json').provider.send(msg)).toEqual({ ok: true });
  });

  it('the factory passes EMAIL_REPLY_TO through to the Brevo provider', async () => {
    const seen: Record<string, unknown>[] = [];
    const real = globalThis.fetch;
    globalThis.fetch = ((_u: string, init: RequestInit) => {
      seen.push(JSON.parse(String(init.body)) as Record<string, unknown>);
      return Promise.resolve(new Response('{}', { status: 201 }));
    }) as unknown as typeof fetch;
    try {
      const p = createEmailProvider(
        {
          EMAIL_PROVIDER: 'brevo',
          BREVO_API_KEY: 'k',
          EMAIL_FROM: 'Haide <no-reply@haide.ro>',
          EMAIL_REPLY_TO: 'help@haide.ro',
        },
        silentLogger,
      );
      await p.send(msg);
    } finally {
      globalThis.fetch = real;
    }
    expect(seen[0]?.replyTo).toEqual({ email: 'help@haide.ro' });
  });

  it('classifies HTTP failures and never puts the address in the error', async () => {
    const make = (status: number) =>
      createBrevoProvider({
        apiKey: 'k',
        from: 'a@b.ro',
        fetchImpl: (() =>
          Promise.resolve(new Response(`bad ${msg.to}`, { status }))) as unknown as typeof fetch,
      });
    const permanent = await make(400).send(msg);
    expect(permanent).toMatchObject({ ok: false, permanent: true });
    expect(JSON.stringify(permanent)).not.toContain('ioana@example.com');
    expect(await make(429).send(msg)).toMatchObject({ ok: false, permanent: false });
    expect(await make(502).send(msg)).toMatchObject({ ok: false, permanent: false });
  });

  it('a network error or timeout is transient', async () => {
    const provider = createBrevoProvider({
      apiKey: 'k',
      from: 'a@b.ro',
      fetchImpl: (() =>
        Promise.reject(new DOMException('timeout', 'TimeoutError'))) as unknown as typeof fetch,
    });
    expect(await provider.send(msg)).toEqual({
      ok: false,
      permanent: false,
      error: 'network:TimeoutError',
    });
  });
});

describe('console provider and factory', () => {
  it('logs the template and ref, never the address', async () => {
    const lines: unknown[] = [];
    const provider = createConsoleProvider((_l, e, f) => lines.push({ e, f }));
    expect(await provider.send(msg)).toEqual({ ok: true });
    const text = JSON.stringify(lines);
    expect(text).toContain('booking_requested');
    expect(text).toContain('abc123def456');
    expect(text).not.toContain('ioana@example.com');
    expect(text).not.toContain('Hello');
  });

  it('picks the provider from EMAIL_PROVIDER', () => {
    const base = { BREVO_API_KEY: 'k', EMAIL_FROM: 'Haide <no-reply@haide.ro>' };
    expect(createEmailProvider({ ...base, EMAIL_PROVIDER: 'console' }, silentLogger).name).toBe(
      'console',
    );
    expect(createEmailProvider({ ...base, EMAIL_PROVIDER: 'brevo' }, silentLogger).name).toBe(
      'brevo',
    );
  });
});
