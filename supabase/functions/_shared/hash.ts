const encoder = new TextEncoder();

function toHex(buf: ArrayBuffer): string {
  return Array.from(new Uint8Array(buf), (b) => b.toString(16).padStart(2, '0')).join('');
}

/** SHA-256 hex digest (WebCrypto: works in Deno and Node). */
export async function sha256Hex(value: string): Promise<string> {
  return toHex(await crypto.subtle.digest('SHA-256', encoder.encode(value)));
}

/**
 * IP hash with a daily rotating salt (architecture §15). The raw IP is never stored or logged.
 * Truncated to 32 hex chars: enough for rate-limit keys, useless for re-identification.
 */
export async function hashIp(ip: string, saltSeed: string, dayKey: string): Promise<string> {
  return (await sha256Hex(`${saltSeed}:${dayKey}:${ip}`)).slice(0, 32);
}

/** Constant-time string comparison for secrets. */
export function safeEqual(a: string, b: string): boolean {
  const ea = encoder.encode(a);
  const eb = encoder.encode(b);
  let diff = ea.length ^ eb.length;
  const len = Math.max(ea.length, eb.length);
  for (let i = 0; i < len; i++) diff |= (ea[i] ?? 0) ^ (eb[i] ?? 0);
  return diff === 0;
}

/** Sortable, unique request id (time prefix + random suffix). */
export function newRequestId(now: Date): string {
  const rand = crypto.getRandomValues(new Uint8Array(8));
  const time = now.getTime().toString(36).padStart(10, '0');
  return `${time}${Array.from(rand, (b) => b.toString(36).padStart(2, '0')).join('')}`.slice(0, 26);
}
