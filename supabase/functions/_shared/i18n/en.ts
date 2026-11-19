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
  'email.report.body': 'Review it in the admin reports queue.',
  'email.dataRequest.subject': 'Data request {requestId}',
  'email.dataRequest.body':
    "User {userId} asked for a copy of their data at {requestedAt}. In the SQL editor run: select app.export_user_data('{userId}'); then send the JSON from privacy@ to the account email and set fulfilled_at on data request {requestId}. Due by {dueBy}.",
  'email.dataAck.subject': 'We got your request for a copy of your data',
  'email.dataAck.body':
    'We’ll email it to this address within 30 days. If you didn’t ask for this, reply to this email.',
  'email.suspended.subject': 'Your Haide account is suspended',
  'email.suspended.body':
    'Ground: {ground}.\n\n{statement}\n\nA person reviewed this, it was not automatic. Your upcoming rides and bookings are cancelled. To appeal, reply to this email.',
  'email.reinstated.subject': 'Your Haide account is active again',
  'email.reinstated.body':
    'A person reviewed your account and lifted the suspension. You can use Haide as before. Rides and bookings that were cancelled stay cancelled.',
  'email.ground.no_show': 'Terms: no-shows',
  'email.ground.unsafe_driving': 'Terms: unsafe driving',
  'email.ground.harassment': 'Terms: harassment',
  'email.ground.extra_money': 'Terms: asking for more than the shared cost',
  'email.ground.fake_profile': 'Terms: a false profile',
  'email.ground.other': 'Terms: other conduct that breaks the rules',
  'email.autoConfirmed.subject': 'Seat booked on your {time} ride',
  'email.autoConfirmed.body':
    'A passenger was confirmed automatically for {pickup} to {dropoff}. Open Haide for the details.',
  'email.alertMatch.subject': 'A ride matches your alert: {fromArea} → {toArea}',
  'email.alertMatch.body':
    'A ride leaves {pickup} for {dropoff} at {time}. Open Haide to request a seat.',
  'email.alertMatch.more': '{count} more rides match too.',
  // Push (E8-4): lock-screen text, area names and times only, never a name.
  'push.booking_requested.title': 'New seat request',
  'push.booking_requested.body':
    'Someone asked for a seat on your {time} ride, {pickup} to {dropoff}.',
  'push.booking_auto_confirmed.title': 'Seat booked',
  'push.booking_auto_confirmed.body':
    'A passenger is booked on your {time} ride, {pickup} to {dropoff}.',
  'push.booking_confirmed.title': 'Request accepted',
  'push.booking_confirmed.body': 'Pickup near {pickup} at {time}.',
  'push.booking_rejected.title': 'Request declined',
  'push.booking_rejected.body': 'Other rides on your route might fit.',
  'push.booking_expired.title': 'Request expired',
  'push.booking_expired.body': 'Your request for the {time} ride was not answered in time.',
  'push.ride_cancelled.title': 'Ride cancelled',
  'push.ride_cancelled.body': 'The {time} ride, {pickup} to {dropoff}, was cancelled.',
  'push.booking_cancelled.title': 'Seat cancelled',
  'push.booking_cancelled.body': 'A passenger cancelled their seat on your {time} ride.',
  'push.ride_alert_match.title': 'A ride matches your alert',
  'push.ride_alert_match.body': '{pickup} to {dropoff}, {time}.',
  'push.ride_alert_match.more': ' {count} more.',
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
