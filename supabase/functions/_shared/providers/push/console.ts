import type { Logger } from '../../log.ts';
import { endpointHost } from '../../domain/push.ts';
import type { PushProvider } from './types.ts';

/**
 * Local and CI provider: logs the host of the push service only, never the endpoint path, keys or
 * payload. Always succeeds, so the dispatcher marks rows sent.
 */
export function createConsolePushProvider(log: Logger): PushProvider {
  return {
    name: 'console',
    send(sub) {
      log('info', 'push_console_send', { host: endpointHost(sub.endpoint) });
      return Promise.resolve({ ok: true });
    },
  };
}
