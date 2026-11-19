import { jwtVerify, importJWK } from 'jose';
import { describe, expect, it } from 'vitest';
import {
  b64urlDecode,
  b64urlEncode,
  classifyStatus,
  createVapidJwt,
  createWebPushProvider,
  encryptAes128gcm,
  importKeyPair,
} from './webpush.ts';

/** RFC 8291 Appendix A: an example message encryption. Values copied from the RFC. */
const RFC = {
  plaintext: 'V2hlbiBJIGdyb3cgdXAsIEkgd2FudCB0byBiZSBhIHdhdGVybWVsb24',
  asPublic:
    'BP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A8',
  asPrivate: 'yfWPiYE-n46HLnH0KqZOF1fJJU3MYrct3AELtAQ-oRw',
  uaPublic:
    'BCVxsr7N_eNgVRqvHtD0zTZsEc6-VV-JvLexhqUzORcxaOzi6-AYWXvTBHm4bjyPjs7Vd8pZGH6SRpkNtoIAiw4',
  authSecret: 'BTBZMqHH6r4Tts7J_aSIgg',
  salt: 'DGv6ra1nlYgDCS1FRnbzlw',
  header:
    'DGv6ra1nlYgDCS1FRnbzlwAAEABBBP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A8',
  ciphertext: '8pfeW0KbunFT06SuDKoJH9Ql87S1QUrdirN6GcG7sFz1y1sqLgVi1VhjVkHsUoEsbI_0LpXMuGvnzQ',
};

const bs = (b: Uint8Array): BufferSource => b as unknown as BufferSource;

describe('RFC 8291 Appendix A test vector', () => {
  it('produces exactly the ciphertext of the RFC for a fixed salt and ephemeral key', async () => {
    const keyPair = await importKeyPair(b64urlDecode(RFC.asPublic), b64urlDecode(RFC.asPrivate));
    const body = await encryptAes128gcm(
      b64urlDecode(RFC.plaintext),
      b64urlDecode(RFC.uaPublic),
      b64urlDecode(RFC.authSecret),
      { salt: b64urlDecode(RFC.salt), keyPair },
    );
    // The RFC prints header and ciphertext as two base64url strings (86 bytes is not a multiple of 3),
    // so compare the bytes, not the concatenated text.
    const header = b64urlDecode(RFC.header);
    expect(header.length).toBe(86);
    expect(Array.from(body.slice(0, 86))).toEqual(Array.from(header));
    expect(b64urlEncode(body.slice(86))).toBe(RFC.ciphertext);
  });

  it('round-trips: the user agent can decrypt what a fresh ephemeral key encrypted', async () => {
    // Receiver side of RFC 8291 section 3.4, written independently of the sender.
    const ua = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, [
      'deriveBits',
    ]);
    const uaPub = new Uint8Array(await crypto.subtle.exportKey('raw', ua.publicKey));
    const auth = crypto.getRandomValues(new Uint8Array(16));
    const message = new TextEncoder().encode(JSON.stringify({ title: 'Hej', body: 'Sibiu' }));
    const body = await encryptAes128gcm(message, uaPub, auth);

    const salt = body.slice(0, 16);
    expect(new DataView(body.buffer, body.byteOffset).getUint32(16)).toBe(4096);
    expect(body[20]).toBe(65);
    const asPub = body.slice(21, 86);
    const record = body.slice(86);

    const asKey = await crypto.subtle.importKey(
      'raw',
      asPub,
      { name: 'ECDH', namedCurve: 'P-256' },
      false,
      [],
    );
    const ecdh = new Uint8Array(
      await crypto.subtle.deriveBits({ name: 'ECDH', public: asKey }, ua.privateKey, 256),
    );
    const hk = async (ikm: Uint8Array, s: Uint8Array, info: Uint8Array, n: number) =>
      new Uint8Array(
        await crypto.subtle.deriveBits(
          { name: 'HKDF', hash: 'SHA-256', salt: bs(s), info: bs(info) },
          await crypto.subtle.importKey('raw', bs(ikm), 'HKDF', false, ['deriveBits']),
          n * 8,
        ),
      );
    const enc = new TextEncoder();
    const keyInfo = new Uint8Array([...enc.encode('WebPush: info\0'), ...uaPub, ...asPub]);
    const ikm = await hk(ecdh, auth, keyInfo, 32);
    const cek = await hk(ikm, salt, enc.encode('Content-Encoding: aes128gcm\0'), 16);
    const nonce = await hk(ikm, salt, enc.encode('Content-Encoding: nonce\0'), 12);
    const plain = new Uint8Array(
      await crypto.subtle.decrypt(
        { name: 'AES-GCM', iv: nonce },
        await crypto.subtle.importKey('raw', cek, 'AES-GCM', false, ['decrypt']),
        record,
      ),
    );
    expect(plain[plain.length - 1]).toBe(2); // the last-record padding delimiter
    expect(new TextDecoder().decode(plain.slice(0, -1))).toBe(new TextDecoder().decode(message));
  });

  it('refuses a malformed user agent key, auth secret or an oversized payload', async () => {
    const good = b64urlDecode(RFC.uaPublic);
    const auth = b64urlDecode(RFC.authSecret);
    await expect(encryptAes128gcm(new Uint8Array(3), good.slice(0, 64), auth)).rejects.toThrow(
      'bad_ua_public_key',
    );
    await expect(encryptAes128gcm(new Uint8Array(3), good, auth.slice(0, 15))).rejects.toThrow(
      'bad_auth_secret',
    );
    await expect(encryptAes128gcm(new Uint8Array(5000), good, auth)).rejects.toThrow(
      'payload_too_large',
    );
  });
});

describe('VAPID (RFC 8292)', () => {
  it('signs an ES256 JWT that verifies against the public key, with aud = the push service origin', async () => {
    const pair = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, [
      'sign',
    ]);
    const jwk = await crypto.subtle.exportKey('jwk', pair.privateKey);
    const pub = new Uint8Array(await crypto.subtle.exportKey('raw', pair.publicKey));
    const keys = { publicKey: b64urlEncode(pub), privateKey: jwk.d as string };
    const nowS = 1_800_000_000;
    const jwt = await createVapidJwt(
      keys,
      'https://fcm.googleapis.com',
      'mailto:support@haide.ro',
      nowS,
    );

    const verifyKey = await importJWK(
      { kty: 'EC', crv: 'P-256', x: jwk.x as string, y: jwk.y as string },
      'ES256',
    );
    const { payload, protectedHeader } = await jwtVerify(jwt, verifyKey, {
      currentDate: new Date((nowS + 60) * 1000),
    });
    expect(protectedHeader.alg).toBe('ES256');
    expect(payload.aud).toBe('https://fcm.googleapis.com');
    expect(payload.sub).toBe('mailto:support@haide.ro');
    expect(payload.exp).toBe(nowS + 12 * 3600);
  });
});

describe('createWebPushProvider', () => {
  const sub = {
    endpoint: 'https://fcm.googleapis.com/fcm/send/abc123',
    p256dh: RFC.uaPublic,
    auth: RFC.authSecret,
  };

  async function setup(status: number | Error) {
    const pair = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, [
      'sign',
    ]);
    const jwk = await crypto.subtle.exportKey('jwk', pair.privateKey);
    const pub = b64urlEncode(new Uint8Array(await crypto.subtle.exportKey('raw', pair.publicKey)));
    const seen: { url: string; init: RequestInit }[] = [];
    const fetchFn = ((url: string, init: RequestInit) => {
      seen.push({ url, init });
      if (status instanceof Error) return Promise.reject(status);
      return Promise.resolve(new Response(null, { status }));
    }) as unknown as typeof fetch;
    const provider = createWebPushProvider({
      publicKey: pub,
      privateKey: jwk.d as string,
      subject: 'mailto:support@haide.ro',
      fetchFn,
      nowS: () => 1_800_000_000,
    });
    return { provider, seen, pub };
  }

  it('POSTs an aes128gcm body with VAPID, TTL and urgency headers', async () => {
    const { provider, seen, pub } = await setup(201);
    const out = await provider.send(sub, new TextEncoder().encode('{"title":"x"}'), {
      ttlS: 1800,
      urgency: 'normal',
    });
    expect(out).toEqual({ ok: true });
    const call = seen[0];
    expect(call?.url).toBe(sub.endpoint);
    const h = call?.init.headers as Record<string, string>;
    expect(h['content-encoding']).toBe('aes128gcm');
    expect(h.ttl).toBe('1800');
    expect(h.urgency).toBe('normal');
    expect(h.authorization).toMatch(new RegExp(`^vapid t=[\\w-]+\\.[\\w-]+\\.[\\w-]+, k=${pub}$`));
    expect(call?.init.method).toBe('POST');
  });

  it('classifies statuses: 201/202 ok, 404/410 gone, 400/403/413 permanent, 429/5xx transient', () => {
    expect(classifyStatus(201)).toEqual({ ok: true });
    expect(classifyStatus(202)).toEqual({ ok: true });
    for (const s of [404, 410]) expect(classifyStatus(s)).toMatchObject({ ok: false, gone: true });
    for (const s of [400, 403, 413]) {
      expect(classifyStatus(s)).toMatchObject({ ok: false, gone: false, permanent: true });
    }
    for (const s of [429, 500, 503]) {
      expect(classifyStatus(s)).toMatchObject({ ok: false, gone: false, permanent: false });
    }
  });

  it('treats a network error as transient and stored garbage keys as permanent', async () => {
    const net = await setup(new Error('boom'));
    expect(
      await net.provider.send(sub, new Uint8Array(3), { ttlS: 60, urgency: 'normal' }),
    ).toMatchObject({
      ok: false,
      permanent: false,
      gone: false,
    });
    const bad = await setup(201);
    expect(
      await bad.provider.send({ ...sub, p256dh: 'AAAA' }, new Uint8Array(3), {
        ttlS: 60,
        urgency: 'normal',
      }),
    ).toMatchObject({ ok: false, permanent: true });
  });
});
