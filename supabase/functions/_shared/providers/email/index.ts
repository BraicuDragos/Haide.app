import type { Env } from '../../env.ts';
import type { Logger } from '../../log.ts';
import { createBrevoProvider } from './brevo.ts';
import { createConsoleProvider } from './console.ts';
import type { EmailProvider } from './types.ts';

export type { EmailMessage, EmailProvider, SendResult } from './types.ts';

/** EMAIL_PROVIDER=brevo needs BREVO_API_KEY (env.ts refuses to boot otherwise). */
export function createEmailProvider(
  env: Pick<Env, 'EMAIL_PROVIDER' | 'BREVO_API_KEY' | 'EMAIL_FROM'> & { EMAIL_REPLY_TO?: string },
  log: Logger,
): EmailProvider {
  if (env.EMAIL_PROVIDER === 'brevo') {
    return createBrevoProvider({
      apiKey: env.BREVO_API_KEY ?? '',
      from: env.EMAIL_FROM,
      replyTo: env.EMAIL_REPLY_TO,
    });
  }
  return createConsoleProvider(log);
}
