import { SHARE_TOKEN_BYTES } from './domain/rules.ts';

/**
 * Share-link tokens (E5, ADR 0026). Not part of domain/ because it uses WebCrypto. A token is 16
 * random bytes (128 bits) as 22 base64url characters. Only its SHA-256 is ever stored, so a database
 * leak cannot reveal a link that still works.
 */

/** The only shape a token can have. Anything else is a 404 without touching the database. */
export const SHARE_TOKEN_RE = /^[A-Za-z0-9_-]{22}$/;

function toBase64Url(bytes: Uint8Array): string {
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function newShareToken(): string {
  return toBase64Url(crypto.getRandomValues(new Uint8Array(SHARE_TOKEN_BYTES)));
}

/** SHA-256 of the token text, 32 bytes. */
export async function hashShareToken(token: string): Promise<Uint8Array> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token));
  return new Uint8Array(digest);
}
