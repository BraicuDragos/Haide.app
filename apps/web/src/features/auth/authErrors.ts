import { t, tError } from '@/i18n';

/** Supabase auth errors carry a `code` such as `over_email_send_rate_limit`. Everything else is the generic message. */
export function authErrorMessage(err: unknown): string {
  const code = (err as { code?: unknown } | null)?.code;
  if (typeof code === 'string' && code.includes('rate_limit')) return tError('RATE_LIMITED');
  return t('error.generic');
}
