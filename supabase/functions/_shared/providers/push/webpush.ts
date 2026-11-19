import { SignJWT, importJWK } from 'jose';
import type { PushOptions, PushProvider, PushSendResult, PushSubscriptionRef } from './types.ts';

/**
 * Minimal Web Push sender (ADR 0038): RFC 8291 message encryption (aes128gcm, one record) and
 * RFC 8292 VAPID, on WebCrypto and the already-pinned `jose`. Checked against the RFC 8291
 * Appendix A test vector (webpush.test.ts), which is why the salt and the application server key
 * pair can be injected.
 */

const enc = new TextEncoder();
export const RECORD_SIZE = 4096;
const VAPID_TTL_S = 12 * 3600;
const SEND_TIMEOUT_MS = 10_000;

export function b64urlEncode(bytes: Uint8Array): string {
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function b64urlDecode(text: string): Uint8Array {
  const pad = '='.repeat((4 - (text.length % 4)) % 4);
  const bin = atob(text.replace(/-/g, '+').replace(/_/g, '/') + pad);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

const concat = (...parts: Uint8Array[]): Uint8Array => {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
};

const buf = (b: Uint8Array): BufferSource => b as unknown as BufferSource;

async function hkdf(
  ikm: Uint8Array,
  salt: Uint8Array,
  info: Uint8Array,
  bytes: number,
): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey('raw', buf(ikm), 'HKDF', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits(
    { name: 'HKDF', hash: 'SHA-256', salt: buf(salt), info: buf(info) },
    key,
    bytes * 8,
  );
  return new Uint8Array(bits);
}

/** Builds a P-256 key pair from the raw 65-byte public point and the 32-byte private scalar. */
export async function importKeyPair(
  publicRaw: Uint8Array,
  privateRaw: Uint8Array,
): Promise<CryptoKeyPair> {
  const x = b64urlEncode(publicRaw.slice(1, 33));
  const y = b64urlEncode(publicRaw.slice(33, 65));
  const base = { kty: 'EC', crv: 'P-256', x, y };
  const publicKey = await crypto.subtle.importKey(
    'jwk',
    base,
    { name: 'ECDH', namedCurve: 'P-256' },
    true,
    [],
  );
  const privateKey = await crypto.subtle.importKey(
    'jwk',
    { ...base, d: b64urlEncode(privateRaw) },
    { name: 'ECDH', namedCurve: 'P-256' },
    true,
    ['deriveBits'],
  );
  return { publicKey, privateKey };
}

export type EncryptOptions = {
  /** 16 random bytes in production. Injected for the RFC test vector. */
  salt?: Uint8Array;
  /** Ephemeral application server key pair. Injected for the RFC test vector. */
  keyPair?: CryptoKeyPair;
};

/**
 * RFC 8291 section 3.4 with the aes128gcm content coding of RFC 8188: header (salt, record size,
 * key id length, sender public key) followed by a single record holding `plaintext || 0x02`.
 */
export async function encryptAes128gcm(
  plaintext: Uint8Array,
  uaPublic: Uint8Array,
  authSecret: Uint8Array,
  opts: EncryptOptions = {},
): Promise<Uint8Array> {
  if (uaPublic.length !== 65 || uaPublic[0] !== 4) throw new Error('bad_ua_public_key');
  if (authSecret.length !== 16) throw new Error('bad_auth_secret');
  if (plaintext.length > RECORD_SIZE - 17 - 1) throw new Error('payload_too_large');

  const salt = opts.salt ?? crypto.getRandomValues(new Uint8Array(16));
  const pair =
    opts.keyPair ??
    ((await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, [
      'deriveBits',
    ])) as CryptoKeyPair);
  const asPublic = new Uint8Array(await crypto.subtle.exportKey('raw', pair.publicKey));

  const uaKey = await crypto.subtle.importKey(
    'raw',
    buf(uaPublic),
    { name: 'ECDH', namedCurve: 'P-256' },
    false,
    [],
  );
  const ecdh = new Uint8Array(
    await crypto.subtle.deriveBits({ name: 'ECDH', public: uaKey }, pair.privateKey, 256),
  );

  const keyInfo = concat(enc.encode('WebPush: info\0'), uaPublic, asPublic);
  const ikm = await hkdf(ecdh, authSecret, keyInfo, 32);
  const cek = await hkdf(ikm, salt, enc.encode('Content-Encoding: aes128gcm\0'), 16);
  const nonce = await hkdf(ikm, salt, enc.encode('Content-Encoding: nonce\0'), 12);

  const aes = await crypto.subtle.importKey('raw', buf(cek), 'AES-GCM', false, ['encrypt']);
  const record = new Uint8Array(
    await crypto.subtle.encrypt(
      { name: 'AES-GCM', iv: buf(nonce) },
      aes,
      buf(concat(plaintext, Uint8Array.of(2))),
    ),
  );

  const header = new Uint8Array(21);
  header.set(salt, 0);
  new DataView(header.buffer).setUint32(16, RECORD_SIZE);
  header[20] = asPublic.length;
  return concat(header, asPublic, record);
}

/** RFC 8292: ES256 JWT with `aud` = the push service origin. */
export async function createVapidJwt(
  keys: { publicKey: string; privateKey: string },
  audience: string,
  subject: string,
  nowS: number,
): Promise<string> {
  const pub = b64urlDecode(keys.publicKey);
  const key = await importJWK(
    {
      kty: 'EC',
      crv: 'P-256',
      x: b64urlEncode(pub.slice(1, 33)),
      y: b64urlEncode(pub.slice(33, 65)),
      d: keys.privateKey,
    },
    'ES256',
  );
  return await new SignJWT({})
    .setProtectedHeader({ alg: 'ES256', typ: 'JWT' })
    .setAudience(audience)
    .setExpirationTime(nowS + VAPID_TTL_S)
    .setSubject(subject)
    .sign(key);
}

export type WebPushConfig = {
  publicKey: string;
  privateKey: string;
  subject: string;
  fetchFn?: typeof fetch;
  nowS?: () => number;
};

/** 201/202 delivered; 404/410 subscription gone; 400/403/413 never deliverable; the rest transient. */
export function classifyStatus(status: number): PushSendResult {
  if (status === 201 || status === 202 || status === 200) return { ok: true };
  if (status === 404 || status === 410)
    return { ok: false, gone: true, permanent: false, error: `http_${status}` };
  if (status === 400 || status === 403 || status === 413) {
    return { ok: false, gone: false, permanent: true, error: `http_${status}` };
  }
  return { ok: false, gone: false, permanent: false, error: `http_${status}` };
}

export function createWebPushProvider(cfg: WebPushConfig): PushProvider {
  const doFetch = cfg.fetchFn ?? fetch;
  const nowS = cfg.nowS ?? (() => Math.floor(Date.now() / 1000));
  return {
    name: 'webpush',
    async send(sub: PushSubscriptionRef, body: Uint8Array, opts: PushOptions) {
      try {
        const payload = await encryptAes128gcm(
          body,
          b64urlDecode(sub.p256dh),
          b64urlDecode(sub.auth),
        );
        const jwt = await createVapidJwt(cfg, new URL(sub.endpoint).origin, cfg.subject, nowS());
        const res = await doFetch(sub.endpoint, {
          method: 'POST',
          headers: {
            authorization: `vapid t=${jwt}, k=${cfg.publicKey}`,
            'content-encoding': 'aes128gcm',
            'content-type': 'application/octet-stream',
            ttl: String(opts.ttlS),
            urgency: opts.urgency,
          },
          body: buf(payload),
          redirect: 'manual', // a push service never redirects: never follow one to another host
          signal: AbortSignal.timeout(SEND_TIMEOUT_MS),
        });
        await res.body?.cancel();
        return classifyStatus(res.status);
      } catch (e) {
        // Bad stored keys can never work; anything else (network, timeout) is transient.
        const name = e instanceof Error ? e.message : 'error';
        if (name === 'bad_ua_public_key' || name === 'bad_auth_secret') {
          return { ok: false, gone: false, permanent: true, error: name };
        }
        return {
          ok: false,
          gone: false,
          permanent: false,
          error: e instanceof Error ? e.name : 'error',
        };
      }
    },
  };
}
