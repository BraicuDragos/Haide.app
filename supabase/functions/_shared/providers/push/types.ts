/** A browser push subscription as stored: endpoint plus the two base64url keys. */
export type PushSubscriptionRef = { endpoint: string; p256dh: string; auth: string };

export type PushOptions = { ttlS: number; urgency: 'very-low' | 'low' | 'normal' | 'high' };

/**
 * `gone`: the push service says the subscription no longer exists (404, 410): delete it.
 * `permanent`: this message can never be delivered to it (400, 403, 413): count a failure.
 * Neither: transient (429, 5xx, network): try again later.
 */
export type PushSendResult =
  { ok: true } | { ok: false; gone: boolean; permanent: boolean; error: string };

/** Port for sending one Web Push message. `body` is the plaintext payload; the provider encrypts it. */
export interface PushProvider {
  readonly name: string;
  send(sub: PushSubscriptionRef, body: Uint8Array, opts: PushOptions): Promise<PushSendResult>;
}
