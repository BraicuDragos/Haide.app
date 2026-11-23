import { scrubText } from '../../scrub.ts';
import type { EmailProvider, SendResult } from './types.ts';

export const BREVO_URL = 'https://api.brevo.com/v3/smtp/email';
export const BREVO_TIMEOUT_MS = 10_000;

/** `Haide <no-reply@haide.ro>` or a bare address. */
export function parseSender(from: string): { name?: string; email: string } {
  const m = /^\s*(.*?)\s*<([^<>\s]+)>\s*$/.exec(from);
  if (m?.[2]) return m[1] ? { name: m[1].replace(/^"|"$/g, ''), email: m[2] } : { email: m[2] };
  return { email: from.trim() };
}

/**
 * Maps an HTTP status to a delivery outcome. 2xx is success. 429 and 5xx are transient (retry with
 * backoff). Every other status (400, 401, 403, ...) is permanent: retrying cannot help.
 */
export function classifyStatus(status: number): 'ok' | 'transient' | 'permanent' {
  if (status >= 200 && status < 300) return 'ok';
  if (status === 429 || status >= 500) return 'transient';
  return 'permanent';
}

type Options = {
  apiKey: string;
  from: string;
  /** Optional Reply-To (`EMAIL_REPLY_TO`), same `Name <address>` or bare address format as `from`. */
  replyTo?: string | undefined;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
};

/** Brevo transactional email over HTTP (`POST /v3/smtp/email`, header `api-key`), 10 s timeout. */
export function createBrevoProvider(opts: Options): EmailProvider {
  const doFetch = opts.fetchImpl ?? fetch;
  const sender = parseSender(opts.from);
  const replyTo = opts.replyTo?.trim() ? parseSender(opts.replyTo) : undefined;
  return {
    name: 'brevo',
    async send(message): Promise<SendResult> {
      let res: Response;
      try {
        res = await doFetch(BREVO_URL, {
          method: 'POST',
          headers: {
            'api-key': opts.apiKey,
            'content-type': 'application/json',
            accept: 'application/json',
          },
          body: JSON.stringify({
            sender,
            ...(replyTo ? { replyTo } : {}),
            to: [{ email: message.to }],
            subject: message.subject,
            textContent: message.text,
            htmlContent: message.html,
            tags: [message.tag],
          }),
          signal: AbortSignal.timeout(opts.timeoutMs ?? BREVO_TIMEOUT_MS),
        });
      } catch (e) {
        // Timeout or network failure: transient. Never include the address in the error.
        const name = e instanceof Error ? e.name : 'error';
        return { ok: false, permanent: false, error: `network:${name}` };
      }
      const kind = classifyStatus(res.status);
      if (kind === 'ok') {
        // Brevo answers 201 {"messageId":"<...>"}. An unreadable body is not a failure: the mail was accepted.
        try {
          const body = (await res.json()) as { messageId?: unknown };
          if (typeof body.messageId === 'string' && body.messageId) {
            // Not scrubText: a real id looks like `<2025...@smtp-relay.mailin.fr>` and the scrubber would
            // turn it into `<[email]>`, losing the only handle for Brevo's logs. It is Brevo's id, not a user address.
            return { ok: true, messageId: body.messageId.slice(0, 120) };
          }
        } catch {
          // no JSON body
        }
        return { ok: true };
      }
      let detail = '';
      try {
        detail = scrubText(await res.text(), 120);
      } catch {
        // body unreadable: the status is enough
      }
      return {
        ok: false,
        permanent: kind === 'permanent',
        error: `brevo:${res.status}${detail ? ` ${detail}` : ''}`,
      };
    },
  };
}
