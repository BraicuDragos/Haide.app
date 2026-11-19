// Prints a new VAPID key pair for web push (E8-4, ADR 0038). Run it ONCE (the owner does, see
// docs/architecture/deploy.md) and store the values as Supabase function secrets:
//   node scripts/vapid-keys.mjs
//   node scripts/vapid-keys.mjs --env     (KEY=value lines, for an env file)
// The private key is printed once and never stored by this script.
import { webcrypto } from 'node:crypto';

const b64url = (bytes) => Buffer.from(bytes).toString('base64url');

const { publicKey, privateKey } = await webcrypto.subtle.generateKey(
  { name: 'ECDH', namedCurve: 'P-256' },
  true,
  ['deriveBits'],
);
const jwk = await webcrypto.subtle.exportKey('jwk', privateKey);
const raw = new Uint8Array(await webcrypto.subtle.exportKey('raw', publicKey));

const pub = b64url(raw); // 65-byte uncompressed point
const priv = jwk.d; // 32-byte scalar, base64url

if (process.argv.includes('--env')) {
  console.log(`VAPID_PUBLIC_KEY=${pub}`);
  console.log(`VAPID_PRIVATE_KEY=${priv}`);
  console.log('VAPID_SUBJECT=mailto:support@haide.ro');
} else {
  console.log(`VAPID_PUBLIC_KEY:  ${pub}`);
  console.log(`VAPID_PRIVATE_KEY: ${priv}`);
  console.log('VAPID_SUBJECT:     mailto:<your support address>');
  console.log(
    'Keep the private key secret. Changing the pair invalidates every browser subscription.',
  );
}
