/**
 * Server-side strings (English). Email copy from docs/ux/copy.md section 34: neighbourhood labels
 * only, never exact addresses, phone numbers or plates. Placeholders are `{name}`.
 * A TypeScript module instead of JSON so Deno and Vitest load it the same way; other languages add
 * a sibling file with the same keys.
 */
export const en = {
  'email.request.subject': '{name} wants a seat on your {time} ride',
  'email.request.body':
    '{name} asked for a seat from {pickup} to {dropoff}. Answer by {deadline} or the request expires. Open Haide to decide.',
  'email.accepted.subject': '{driver} accepted your request',
  'email.accepted.body':
    'Pickup is near {pickup} at {time}. Open Haide for the exact point and contact details.',
  'email.rejected.subject': '{driver} can’t take you this time',
  'email.rejected.body': 'Other rides on your route might fit. Open Haide to search again.',
  'email.expired.subject': 'Your request for the {time} ride expired',
  'email.expired.body': '{driver} didn’t answer in time. Open Haide to find another ride.',
  'email.rideCancelled.subject': '{driver} cancelled the {time} ride',
  'email.rideCancelled.body':
    'The ride from {pickup} to {dropoff} won’t happen. Open Haide to find another ride.',
  'email.bookingCancelled.subject': '{name} cancelled their seat on your {time} ride',
  'email.bookingCancelled.body':
    'Your price per passenger is recalculated. It never goes up for passengers already accepted.',
  'email.priceDropped.body': 'Price changed to {price} because a second passenger joined.',
  'email.openLabel': 'Open Haide',
  'email.open': 'Open Haide: {link}',
  'email.footer': 'You get this email because of activity on your Haide account.',
  'email.fallback.passenger': 'A passenger',
  'email.fallback.driver': 'Your driver',
} as const;

export type MessageKey = keyof typeof en;

/** Fills `{placeholders}`. A missing value stays visible as `{name}` rather than becoming "undefined". */
export function t(key: MessageKey, vars: Record<string, string> = {}): string {
  return en[key].replace(/\{(\w+)\}/g, (whole, name: string) => vars[name] ?? whole);
}
