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
  'email.rideCancelled.system.subject': 'The {time} ride with {driver} was cancelled',
  'email.ratePrompt.subject': 'How was your ride with {driver}?',
  'email.ratePrompt.body':
    'Rate {driver} within 7 days. They see your rating once you’ve both rated.',
  'email.ratePromptDriver.subject': 'Rate your passengers from the {time} ride',
  'email.ratePromptDriver.body':
    'You have 7 days. Ratings stay hidden until both sides have rated.',
  'email.noShow.subject': '{name} reported a no-show on the {time} ride',
  'email.noShow.body':
    'It shows on your profile for 90 days. If this is wrong, open Haide and report a problem.',
  'email.report.subject': 'New safety report: {reason}',
  'email.report.body': 'Review it in the database until the reports queue ships.',
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
