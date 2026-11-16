import type { Logger } from '../../log.ts';
import type { EmailProvider } from './types.ts';

/**
 * Local and CI provider: logs the template and a hash of the user id, never the address, subject or
 * body. Always succeeds, so integration tests see the outbox row become `sent`.
 */
export function createConsoleProvider(log: Logger): EmailProvider {
  return {
    name: 'console',
    send(message) {
      log('info', 'email_console_send', { template: message.tag, ref: message.ref });
      return Promise.resolve({ ok: true });
    },
  };
}
