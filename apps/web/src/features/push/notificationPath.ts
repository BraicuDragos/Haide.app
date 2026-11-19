/** Only a same-origin in-app path is ever opened from a notification: one leading "/", no backslash, no scheme. */
export function safeNotificationPath(p: unknown): string {
  return typeof p === 'string' && p.startsWith('/') && !p.startsWith('//') && !p.includes('\\')
    ? p
    : '/rides';
}
