/** Outgoing email port (ADR 0022). Providers never throw for delivery problems: they classify them. */

export type EmailMessage = {
  to: string;
  subject: string;
  text: string;
  html: string;
  /** The outbox template, used as the provider tag. */
  tag: string;
  /** Short hash of the recipient's user id. Logs use it instead of the address. */
  ref: string;
};

export type SendResult =
  | { ok: true }
  /** `permanent`: do not retry (a 4xx other than 429). Otherwise retry with backoff. */
  | { ok: false; permanent: boolean; error: string };

export interface EmailProvider {
  readonly name: 'console' | 'brevo';
  send(message: EmailMessage): Promise<SendResult>;
}
