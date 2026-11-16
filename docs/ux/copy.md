# UX copy deck (English)

> Owner: ux-designer · Date: 2026-11-15 (E-DM update) · Voice: [brand-guide §7](../brand/brand-guide.md) · Prototype: [prototype/index.html](prototype/index.html) · Decisions: ADRs [0008](../decisions/0008-navigation-and-information-architecture.md)–[0011](../decisions/0011-price-and-money-presentation.md), [0020](../decisions/0020-haide-wordmark-sanctioned-exclamation.md) (the one exclamation mark) · Motion: [motion.md](motion.md)
>
> **Keys below = keys in the `STR` object of the prototype** (`prototype/src/strings.js`). `node docs/ux/prototype/tools/check-copy.mjs` fails when the deck and the prototype drift, or when any value other than `launch.haide` contains an exclamation mark. `frontend-dev` should move these keys into the i18n resource file as they are (flat dotted keys, English only in the MVP).

## 1. Voice in one screen

**Neighbourly, plain, dependable.** Short sentences. The exact thing that happens. Specific times, places and prices.

| Rule | Example from the deck |
|---|---|
| Buttons start with a verb and name the outcome | “Request seat”, “Publish ride”, “Send report” |
| One action keeps one name everywhere | Button “Request seat” → toast “Seat requested” → status “Waiting for answer” |
| Errors say what happened, then what to do | “Choose a time at least 15 minutes from now.” |
| No apology, no hype, no “Oops”, no “Something went wrong” | “We couldn’t load rides. Check your connection and try again.” |
| Costs are **shared**, never “earned” | “You recover about 4.50 RON of the 6.24 RON fuel cost.” |
| Never “fare”, “order”, “booking fee”, “trip request” | We say ride, driver, passenger, seat, pickup point |
| Sentence case, no all caps, no emoji. **No exclamation marks, with exactly one exception** (ADR 0020): the wordmark `Haide!` (`launch.haide`) flashes inside the launch moment of Publish ride and Request seat, only when the action really left, decorative (`aria-hidden`), never in a toast, status, error, empty state, loader or the screen-reader announcement | The announcement stays plain: “Seat requested”, “Ride published” |
| Loaders and empty states describe what is happening in one plain line; the animation is decoration | “Looking for rides on your route”, not “Hang tight!” | 
| Money: `3.90 RON` (non-breaking space, 2 decimals). Time: 24 h `07:30` | |
| Price is always labelled for what it is | Cards: “Up to 3.80 RON” + “Drops if others join”. After acceptance: “You pay Radu 2.50 RON” |
| Say who decides | “Radu decides whether to accept.” |

## 2. Vocabulary (use these words only)

| Use | Not |
|---|---|
| ride | trip request, listing, offer (as noun), job |
| driver, passenger | partner, rider (internal docs only), customer |
| seat, request seat, accepted, declined | book now, reserve, approved |
| pickup point, drop-off point | stop, location (in UI) |
| recover fuel cost, share cost | earn, profit, income, payout |
| price (what a passenger pays) | fare, rate, charge |
| cancel booking, cancel ride | withdraw, abort |

## 3. i18n rules for `frontend-dev`

- Flat dotted keys, English values. Params in `{braces}` and are HTML-escaped by the renderer.
- Plurals use `key.one` / `key.other` with `{n}`. Romanian will need `few`, so keep the suffix mechanism open (ICU-style) when the resource system is chosen.
- Never build sentences by concatenating keys, with one documented exception: `consent.terms.*` (four fragments around two links).
- Names and Romanian addresses are user data. Keep them as typed (UTF-8). Do not title-case or transliterate.
- Currency is always `RON`, formatted by a single helper. Dates use the Europe/Bucharest timezone. The native time input follows the device locale (24 h on Romanian devices).
- Max lengths for layout: button labels ≤ 28 characters, toasts ≤ 70, sheet titles ≤ 40, tab labels ≤ 10.

## 4. Patterns

| Pattern | Structure | Example |
|---|---|---|
| Empty state | What this is, why it is empty, one way to start | “No rides booked yet. Find a ride and send a request. It will show up here.” + “Find a ride” |
| Error | What happened + what to do | “This ride just filled up. See other rides on your route.” |
| Confirm dialog | Verb question, consequence, verb button vs keep button | “Cancel your seat?” … “Cancel booking” / “Keep my seat” |
| Late-cancel warning | Plain consequence, no “Warning!” | “Cancelling within 30 minutes of departure counts as a late cancellation on your profile.” |
| Success toast | Same verb as the button, past tense | “Seat requested”, “Rating sent”, “Report sent” |
| Loading | Say what is being looked for, present continuous, no ellipsis, no “please wait”. A small light travels a tiny route; the line is a live status | “Looking for rides on your route” |
| Empty | Same structure as above. The route waits (one dot breathes) and the one action is the primary button | “No rides yet on this route” |
| Launch moment | Label, then the wordmark flash (full motion only), then the confirmed text. The confirmed text is the toast text | “Request seat” → “Haide!” → “Seat requested” |

## 5. App

Name, tagline and pronunciation helper. Write Haide with a capital H in running text; the wordmark is lowercase.

| Key | English |
|---|---|
| `app.name` | Haide |
| `app.tagline` | The neighbourly way across Sibiu. |
| `app.pronounce` | Haide (HIGH-deh) is Romanian for “come on, let’s go.” |

## 6. Common

Reused labels. Prefer these over new variants.

| Key | English |
|---|---|
| `common.back` | Back |
| `common.close` | Close |
| `common.continue` | Continue |
| `common.done` | Done |
| `common.edit` | Edit |
| `common.change` | Change |
| `common.save` | Save changes |
| `common.optional` | optional |
| `common.you` | You |
| `common.free` | Free |
| `common.viewProfile` | View profile |
| `common.today` | Today |
| `common.tomorrow` | Tomorrow |
| `common.min` | {n} min |
| `common.km` | {n} km |
| `common.m` | {n} m |
| `common.approx` | Approximate |
| `common.exact` | Exact |
| `common.skipToMain` | Skip to main content |
| `common.moreOptions` | More options |
| `common.new` | New |

## 7. Navigation

Bottom tab bar. Four tabs, one word each.

| Key | English |
|---|---|
| `nav.label` | Main |
| `nav.find` | Find |
| `nav.offer` | Offer |
| `nav.rides` | My rides |
| `nav.profile` | Profile |
| `nav.updates.one` | 1 update |
| `nav.updates.other` | {n} updates |

## 8. Find a ride (E3-1)

Search form. Visitors can use it without an account.

| Key | English |
|---|---|
| `find.title` | Find a ride |
| `find.subtitle` | Neighbours already driving your way. Usually 1 to 4 RON. |
| `find.from` | From |
| `find.to` | To |
| `find.fromPlaceholder` | Where do you start? |
| `find.toPlaceholder` | Where are you going? |
| `find.swap` | Swap from and to |
| `find.day` | Day |
| `find.time` | Leave around |
| `find.window` | Flexibility |
| `find.window.15` | ±15 min |
| `find.window.30` | ±30 min |
| `find.window.60` | ±1 hour |
| `find.cta` | Search rides |
| `find.corridors` | Popular routes |
| `find.corridor.south` | Cisnădie to Piața Mare |
| `find.corridor.west` | Șelimbăr to Zona Industrială Vest |
| `find.corridor.campus` | Hipodrom to the old town |
| `find.visitorHint` | You can look around without an account. |
| `find.err.missing` | Choose where you start and where you’re going. |
| `find.err.same` | Start and destination are the same place. Choose two different places. |
| `find.err.timeMissing` | Choose a time. |
| `find.corridors.err` | We couldn’t load that route. Choose the places yourself. |

## 9. Place picker (E3-1, E2-1)

Address search is diacritics-insensitive: “Selimbar” finds “Șelimbăr”. Device location is used once, in the foreground, after the OS permission prompt.

| Key | English |
|---|---|
| `place.title.from` | Where do you start? |
| `place.title.to` | Where are you going? |
| `place.search` | Search a street or place in Sibiu |
| `place.myLocation` | Use my location |
| `place.myLocation.hint` | Used once, only while you’re in the app. |
| `place.onMap` | Choose on map |
| `place.suggestions` | Suggestions |
| `place.count.one` | 1 place found |
| `place.count.other` | {n} places found |
| `place.noMatch` | No match for “{q}”. Try a street, neighbourhood or landmark in Sibiu. |
| `place.locating` | Finding your location |
| `place.permissionDenied` | Location is off for Haide. Search for an address instead. |
| `place.mapSoon` | Choosing on a map is part of the full app. Search for a place for now. |

## 10. Results and empty states (E3-2, E3-5)

Zero results is never a dead end: show nearest rides, offer an alert (alerts activate in E8).

| Key | English |
|---|---|
| `results.title.loading` | Looking for rides |
| `results.title.empty` | No rides found |
| `results.count.one` | 1 ride found |
| `results.count.other` | {n} rides found |
| `results.route` | {from} to {to} |
| `results.when` | {day}, {time}, {win} |
| `results.editSearch` | Edit search |
| `results.sortNote` | Closest to your route first. |
| `results.loading` | Looking for rides on your route |
| `results.error.title` | We couldn’t load rides |
| `results.error` | Check your connection and try again. |
| `results.retry` | Try again |
| `results.empty.title` | No rides yet on this route |
| `results.empty.body` | Drivers publish rides every day. Tell us when you travel and we’ll let you know. |
| `results.empty.alt` | Closest rides outside your time window |
| `results.empty.edit` | Change time or places |
| `results.empty.notify` | Notify me about this route |
| `results.notified` | Saved. We’ll email you when a matching ride appears. |
| `results.notified.state` | Alert saved for this route |
| `results.blockedNote` | Rides from people you’ve blocked are hidden. |
| `results.notify.soon` | Ride alerts are coming soon. |
| `results.list` | Rides found |

## 11. Ride card

Price is always “Up to X” on cards: it assumes you ride alone with the driver and drops as others join.

| Key | English |
|---|---|
| `card.upTo` | Up to |
| `card.drops` | Drops if others join |
| `card.seatsLeft.one` | 1 seat left |
| `card.seatsLeft.other` | {n} seats left |
| `card.walkTo` | {m} m walk to pickup |
| `card.walkFrom` | {m} m walk from drop-off |
| `card.rating` | Rated {r} from {n} ratings |
| `card.outsideWindow` | {n} min from your time |
| `card.free` | Free ride |
| `card.pickupAround` | Pickup around {time} |

## 12. Ride detail (E3-3)

Public view. Approximate areas only, plate hidden, no phone.

| Key | English |
|---|---|
| `detail.title` | Ride details |
| `detail.loading` | Getting the ride details |
| `detail.pickup` | Pickup |
| `detail.dropoff` | Drop-off |
| `detail.approx` | Approximate area. You’ll see the exact point once {driver} accepts. |
| `detail.walk.to` | About {m} m on foot from where you start |
| `detail.walk.from` | About {m} m on foot to where you’re going |
| `detail.driver` | Driver |
| `detail.car` | Car |
| `detail.car.value` | {colour} {make} {model} |
| `detail.map.desc` | Pickup: {pickup}. Drop-off: {dropoff}. |
| `detail.plateLocked` | Number plate shows after you’re accepted |
| `detail.plateLocked.why` | Haide shares the plate only with accepted passengers, so strangers can’t tell where you’ll be. |
| `detail.note` | Note from {driver} |
| `detail.priceTitle` | What you pay |
| `detail.priceNote` | The price drops if others join. Once you’re accepted, it can only go down. |
| `detail.priceTable.caption` | Price per passenger, by number of passengers on the ride |
| `detail.priceTable.col1` | Passengers |
| `detail.priceTable.col2` | Each pays |
| `detail.priceTable.n.one` | 1 passenger |
| `detail.priceTable.n.other` | {n} passengers |
| `detail.payDirect` | You pay {driver} directly, in cash or by transfer. Haide doesn’t handle money. |
| `detail.fuelNote` | This only splits fuel cost. {driver} pays a share too. |
| `detail.cta` | Request seat |
| `detail.full` | This ride is full |
| `detail.tooLate` | Requests close 10 minutes before departure |
| `detail.ownRide` | This is your ride |
| `detail.alreadyRequested` | You already have a seat on this ride |
| `detail.noLongerMatches` | This ride no longer fits your search. Try a new search. |
| `detail.seatsLeft.one` | 1 seat left of {total} |
| `detail.seatsLeft.other` | {n} seats left of {total} |
| `detail.gone` | This ride is no longer available. It may have been cancelled or already left. |
| `detail.gone.cta` | Back to results |
| `detail.blocked` | This ride isn’t available to you. |
| `detail.needSearch` | Search with your start and destination to request a seat. |
| `detail.needSearch.cta` | Search this route |
| `detail.requestSoon` | Requesting a seat opens with the next release. |
| `detail.err` | We couldn’t load this ride. Check your connection and try again. |

## 13. Request a seat (E4-1)

Request-then-approve. The sheet says who decides, until when, and what stays hidden.

| Key | English |
|---|---|
| `request.title` | Request a seat |
| `request.summary` | {time} · {from} to {to} |
| `request.line.decides` | {driver} decides whether to accept. You’ll get an email and see the answer in My rides. |
| `request.line.expires` | If {driver} doesn’t answer by {deadline}, the request expires. |
| `request.line.approx` | Pickup and drop-off stay approximate until {driver} accepts. |
| `request.send` | Send request |
| `request.sending` | Sending request |
| `request.offline` | No connection. We’ll send your request when you’re back online. |
| `request.sent.toast` | Seat requested |
| `request.err.full` | This ride just filled up. See other rides on your route. |
| `request.err.late` | This ride leaves in under 10 minutes, so requests are closed. |
| `request.err.limit` | You already have a request on this ride. |

## 13a. The Haide moment, match and live trip (E-DM)

Motion moments need a few strings. The launch button shows its label, then (with motion on) the wordmark for about 400 ms, then the confirmed text. Screen readers hear the status line only. See [motion.md](motion.md) moments 2, 6 and 7.

| Key | English |
|---|---|
| `launch.haide` | Haide! |
| `request.saved` | Request saved |
| `match.fit` | Fits your route. {m} m walk to pickup. |
| `live.caption` | {driver} leaves at {time}. |
| `live.leavesIn` | Leaves in {n} min |
| `live.now` | Leaving now |
| `live.note` | The light follows the route, not the car. Haide doesn’t track drivers. |

Where the existing keys are used by the launch moment and the branded states (no new strings needed):

| Moment | Keys shown or announced |
|---|---|
| Request seat launch | label `request.send`, wordmark `launch.haide`, confirmed `request.sent.toast` (offline: `request.saved`, no wordmark), announced `request.sending` then the toast |
| Publish ride launch | label `offer.cta`, wordmark `launch.haide`, confirmed `offer.done.title`, announced `offer.publishing` |
| Results loading | `results.loading` |
| Route loading on Offer | `offer.route.loading` |
| Empty: results, My rides, Profile | `results.empty.title`, `rides.empty.riding.title`, `rides.visitor.title`, `me.visitor.title` and their bodies |
| Price drop | `booking.priceDropped`, `a11y.priceDropped` (the ring pulse is decoration, the sentence is the message) |

`live.note` is deliberate: live GPS tracking is out of the MVP (ADR 0005), so the ambient light on the ride-day card shows the schedule, and the card says so. When tracking exists, revisit this copy together with ADR 0005.

## 14. Sign in (E1-1)

Google or email magic link. No password anywhere.

| Key | English |
|---|---|
| `auth.title` | Sign in or create an account |
| `auth.subtitle.request` | You need an account to request a seat. It takes about a minute. |
| `auth.subtitle.offer` | You need an account to offer a ride. It takes about two minutes. |
| `auth.subtitle.default` | It takes about a minute. No password needed. |
| `auth.google` | Continue with Google |
| `auth.or` | or |
| `auth.email` | Email address |
| `auth.email.send` | Email me a sign-in link |
| `auth.email.err` | Enter an email address like name@example.com. |
| `auth.email.hint` | We’ll send a link that works once. No password. |
| `auth.check.title` | Check your email |
| `auth.check.body` | We sent a sign-in link to {email}. It works once and expires in 15 minutes. |
| `auth.check.resend` | Send a new link |
| `auth.check.resent` | New link sent |
| `auth.check.wrong` | Use a different email |
| `auth.link.expired` | This link has expired or was already used. Request a new one. |

## 15. Agreement (E1-2)

18+ attestation plus Terms and Privacy policy. Two checkboxes, two separate errors. The terms label is built from four fragments around two links: translators must keep the order or request a single rich-text key.

| Key | English |
|---|---|
| `consent.title` | Before you start |
| `consent.body` | Haide is for people aged 18 and over. Drivers share fuel costs, they don’t make a profit. We keep your location data to what a ride needs. |
| `consent.age` | I am 18 or older |
| `consent.terms.pre` | I accept the  |
| `consent.terms.tos` | Terms of use |
| `consent.terms.and` |  and the  |
| `consent.terms.pp` | Privacy policy |
| `consent.cta` | Agree and continue |
| `consent.decline` | Decline and sign out |
| `consent.err.age` | Confirm that you are 18 or older to continue. |
| `consent.err.terms` | Accept the Terms of use and Privacy policy to continue. |

## 16. Onboarding steps

Progress copy. The number of steps is 3 for passengers and 4 for drivers.

| Key | English |
|---|---|
| `setup.step` | Step {n} of {total} |
| `setup.step.account` | Account |
| `setup.step.agreement` | Agreement |
| `setup.step.profile` | Profile |
| `setup.step.car` | Car |
| `setup.profile.title` | Tell your neighbours who you are |
| `setup.profile.body` | Drivers and passengers see your first name and photo. Your phone number is shared only after a seat is accepted. |
| `setup.profile.cta` | Save and continue |

## 17. Profile (E1-3)

First name, photo, phone required before booking or publishing. Bio optional.

| Key | English |
|---|---|
| `profile.photo` | Photo |
| `profile.photo.add` | Add photo |
| `profile.photo.change` | Change photo |
| `profile.photo.hint` | JPEG or PNG, up to 5 MB. We remove location data from photos. |
| `profile.firstName` | First name |
| `profile.phone` | Phone number |
| `profile.phone.hint` | A Romanian mobile, like 0721 234 567. Shared only with people you ride with. |
| `profile.bio` | About you |
| `profile.bio.hint` | {n} of 200 characters |
| `profile.bio.placeholder` | Where you commute, music or no music, anything helpful. |
| `profile.err.name` | Enter your first name, up to 30 letters. |
| `profile.err.phone` | Enter a Romanian mobile number, like 0721 234 567. |
| `profile.err.photo` | Add a photo so people can recognise you. |
| `profile.err.photoSize` | This photo is over 5 MB. Choose a smaller JPEG or PNG. |
| `profile.err.photoInvalid` | We couldn’t read this photo. Choose a JPEG or PNG. |
| `profile.edit.title` | Edit profile |

## 18. Vehicle (E1-4)

One car per driver. Fuel type sets the price rate; the driver never enters consumption.

| Key | English |
|---|---|
| `vehicle.title` | Your car |
| `vehicle.body` | Passengers use this to spot your car at pickup. The fuel type sets the cost share. |
| `vehicle.make` | Make |
| `vehicle.model` | Model |
| `vehicle.colour` | Colour |
| `vehicle.plate` | Number plate |
| `vehicle.plate.hint` | Only passengers you’ve accepted can see it. |
| `vehicle.fuel` | Fuel type |
| `vehicle.fuel.petrol` | Petrol |
| `vehicle.fuel.diesel` | Diesel |
| `vehicle.fuel.lpg` | LPG |
| `vehicle.fuel.hybrid` | Hybrid |
| `vehicle.fuel.electric` | Electric |
| `vehicle.seats` | Seats for passengers |
| `vehicle.seats.hint` | Not counting you. Up to 4. |
| `vehicle.save` | Save car |
| `vehicle.err.required` | Fill in this field. |
| `vehicle.err.plate` | Enter your number plate, like SB 38 AND. |
| `vehicle.note` | Changing your car doesn’t change rides you’ve already published. |

## 19. Offer a ride (E2)

Driver publishing flow with the price preview (E2-2). The driver can lower the price to free, never raise it.

| Key | English |
|---|---|
| `offer.title` | Offer a ride |
| `offer.subtitle` | Share a trip you’re making anyway and recover part of the fuel. |
| `offer.from` | From |
| `offer.to` | To |
| `offer.when` | When |
| `offer.day` | Day |
| `offer.time` | Leaving at |
| `offer.seats` | Free seats |
| `offer.seats.dec` | Fewer seats |
| `offer.seats.inc` | More seats |
| `offer.seats.value.one` | 1 seat |
| `offer.seats.value.other` | {n} seats |
| `offer.seats.hint` | Your car has {n} seats. |
| `offer.note` | Note for passengers |
| `offer.note.placeholder` | Where you’ll wait, space for bags, anything useful. |
| `offer.note.hint` | {n} of 200 characters |
| `offer.route.loading` | Working out your route |
| `offer.route.result` | {km} km, about {min} min |
| `offer.route.err` | We couldn’t work out this route. Check both places and try again. |
| `offer.route.retry` | Try again |
| `offer.price.title` | What passengers pay |
| `offer.price.body` | Fuel cost split between everyone in the car, you included. |
| `offer.price.fuel` | {fuel}, {km} km |
| `offer.price.recover.one` | With 1 passenger you recover about {amount} of the {fuel} fuel cost. |
| `offer.price.recover.other` | With {n} passengers you recover about {amount} of the {fuel} fuel cost. |
| `offer.price.lock` | The price is set by Haide. You can’t raise it. |
| `offer.price.waiting` | Choose both places to see the price. |
| `offer.free` | Offer this ride for free |
| `offer.free.hint` | Passengers pay nothing. |
| `offer.repeat` | Repeat on weekdays |
| `offer.repeat.soon` | Coming soon |
| `offer.cta` | Publish ride |
| `offer.publishing` | Publishing ride |
| `offer.err.places` | Choose where you start and where you’re going. |
| `offer.err.time` | Choose a time at least 15 minutes from now. |
| `offer.err.timeFar` | You can publish up to 14 days ahead. |
| `offer.err.limit` | You’ve reached 4 rides on {day}. Choose another day. |
| `offer.err.distance` | Rides must be between 1 and 40 km. |
| `offer.err.same` | Start and destination are the same place. Choose two different places. |
| `offer.err.seats` | Your car has {n} seats. Choose fewer seats. |
| `offer.err.expired` | Your route price timed out. We’ve worked it out again. Check the price and publish once more. |
| `offer.err.offline` | You’re offline. Connect to publish your ride. |
| `offer.needCar.title` | Add your car first |
| `offer.needCar.body` | Passengers need to know what to look for, and the fuel type sets the price. |
| `offer.needCar.cta` | Add car |
| `offer.done.title` | Ride published |
| `offer.done.body` | Passengers can find your ride now. We’ll email you when someone requests a seat. |
| `offer.done.view` | View my ride |
| `offer.done.another` | Publish another ride |
| `offer.private` | Passengers see approximate areas only until you accept them. |

## 20. My rides (E2-3, E4)

Two levels of tabs: Riding or Driving, then Upcoming or Past.

| Key | English |
|---|---|
| `rides.title` | My rides |
| `rides.riding` | Riding |
| `rides.driving` | Driving |
| `rides.upcoming` | Upcoming |
| `rides.past` | Past |
| `rides.tabs.role` | Riding or driving |
| `rides.tabs.when` | Upcoming or past |
| `rides.loading` | Loading your rides |
| `rides.err` | We couldn’t load your rides. Check your connection and try again. |
| `rides.more` | Show more |
| `rides.empty.riding.title` | No rides booked yet |
| `rides.empty.riding.body` | Find a ride and send a request. It will show up here. |
| `rides.empty.riding.cta` | Find a ride |
| `rides.empty.driving.title` | You haven’t offered a ride yet |
| `rides.empty.driving.body` | Publish a trip you make anyway. It takes about a minute. |
| `rides.empty.driving.cta` | Offer a ride |
| `rides.empty.past` | Nothing here yet. Finished rides show up here. |
| `rides.requests.one` | 1 request |
| `rides.requests.other` | {n} requests |
| `rides.seatsTaken` | {booked} of {total} seats taken |
| `rides.rateCta` | Rate your ride |
| `rides.visitor.title` | Sign in to see your rides |
| `rides.visitor.body` | Requests, accepted seats and your published rides live here. |
| `rides.visitor.cta` | Sign in or create account |

## 21. Status labels

One label per booking or ride state. Always shown with an icon or colour plus the word.

| Key | English |
|---|---|
| `status.requested` | Waiting for answer |
| `status.confirmed` | Accepted |
| `status.rejected` | Declined |
| `status.expired` | Expired |
| `status.cancelled` | Cancelled |
| `status.completed` | Completed |
| `status.no_show` | No-show |
| `status.published` | Published |
| `status.rideCancelled` | Ride cancelled |

## 22. Booking, passenger side (E4)

Exact points, phone and plate appear only after acceptance and hide 24 hours after the ride.

| Key | English |
|---|---|
| `booking.title` | Your seat |
| `booking.requested.title` | Waiting for {driver} |
| `booking.requested.body` | {driver} has until {deadline} to answer. We’ll email you either way. |
| `booking.confirmed.title` | {driver} accepted your request |
| `booking.confirmed.body` | Be at the pickup point 5 minutes early. |
| `booking.rejected.title` | {driver} can’t take you this time |
| `booking.rejected.body` | Other rides on your route might fit. |
| `booking.expired.title` | Request expired |
| `booking.expired.body` | {driver} didn’t answer in time. Try another ride. |
| `booking.cancelled.title` | You cancelled this booking |
| `booking.rideCancelled.title` | {driver} cancelled this ride |
| `booking.rideCancelled.body` | Other rides on your route might fit. |
| `booking.completed.title` | Ride completed |
| `booking.completed.body` | Rate {driver} to help the next passenger. |
| `booking.noShow.title` | Marked as a no-show |
| `booking.findAnother` | Find another ride |
| `booking.pay` | You pay {driver} |
| `booking.pay.how` | In cash or by transfer when you meet. Haide doesn’t handle money. |
| `booking.pay.final` | Final price. Same for you and {driver}. |
| `booking.pickup` | Pickup point |
| `booking.dropoff` | Drop-off point |
| `booking.pickup.approx` | Approximate until accepted |
| `booking.contact` | Contact {driver} |
| `booking.call` | Call |
| `booking.whatsapp` | WhatsApp |
| `booking.plate` | Number plate |
| `booking.car` | Car |
| `booking.hiddenAfter` | Contact details and exact points hide 24 hours after the ride. |
| `booking.priceDropped` | Price dropped to {price} because another passenger joined. |
| `booking.priceNever` | Your price can only go down. |
| `booking.leaves` | Leaves at {time} |
| `booking.cancel` | Cancel booking |
| `booking.cancel.title` | Cancel your seat? |
| `booking.cancel.body` | {driver} will be told. You can request another ride any time. |
| `booking.cancel.late` | Cancelling within 30 minutes of departure counts as a late cancellation on your profile. |
| `booking.cancel.confirm` | Cancel booking |
| `booking.cancel.keep` | Keep my seat |
| `booking.cancel.toast` | Booking cancelled |
| `booking.step.requested` | Requested |
| `booking.step.accepted` | Accepted |
| `booking.step.ride` | Ride |
| `booking.step.rate` | Rate |
| `booking.queued` | Not sent yet. We’ll send your request when you’re back online. |
| `booking.rating.sent` | You rated {driver} |

## 23. Ride day (E5-2, E5-6, E5-7)

Share link and Call 112 are Should items; the strings are ready.

| Key | English |
|---|---|
| `rideday.banner` | Ride day. Leaves in 10 minutes. |
| `rideday.share` | Share trip link |
| `rideday.share.body` | Send a read-only page with the driver, car and route to someone you trust. It stops working 24 hours after the ride. |
| `rideday.share.copy` | Copy link |
| `rideday.share.copied` | Link copied |
| `rideday.call112` | Call 112 |
| `rideday.call112.hint` | For an emergency. |
| `rideday.driverMissing` | Driver didn’t show |
| `rideday.driverMissing.title` | Report that {driver} didn’t show? |
| `rideday.driverMissing.body` | It appears on their profile for 90 days. You can do this within 24 hours of departure. |
| `rideday.driverMissing.confirm` | Report no-show |
| `rideday.driverMissing.toast` | No-show reported |
| `rideday.noShow` | Mark no-show |
| `rideday.noShow.title` | Mark {name} as a no-show? |
| `rideday.noShow.body` | It appears on their profile for 90 days. You can do this within 24 hours of departure. |
| `rideday.noShow.confirm` | Mark no-show |
| `rideday.noShow.keep` | Not a no-show |
| `rideday.noShow.toast` | {name} marked as a no-show |
| `rideday.problem` | Report a problem |

## 24. Driver ride (E2-4, E4-2)

Requests, passengers, cancel and no-show.

| Key | English |
|---|---|
| `driverRide.title` | Your ride |
| `driverRide.loading` | Loading your ride |
| `driverRide.requests` | Requests |
| `driverRide.noRequests` | No requests yet. We’ll email you when someone asks for a seat. |
| `driverRide.passengers` | Passengers |
| `driverRide.noPassengers` | No passengers yet. |
| `driverRide.accept` | Accept |
| `driverRide.decline` | Decline |
| `driverRide.accept.toast` | {name} accepted |
| `driverRide.decline.toast` | Request declined |
| `driverRide.request.route` | {pickup} to {dropoff} |
| `driverRide.request.pays` | Pays {price} with {n} passengers |
| `driverRide.request.pays.one` | Pays {price} if alone |
| `driverRide.priceNow` | Everyone pays {price} now. |
| `driverRide.recover` | You recover about {amount} of {fuel} fuel cost. |
| `driverRide.recover.none` | No passengers yet. Your fuel cost is {fuel}. |
| `driverRide.seats.full` | Ride is full |
| `driverRide.err.full` | All seats are taken. Decline this request or free a seat first. |
| `driverRide.cancel` | Cancel ride |
| `driverRide.cancel.title` | Cancel this ride? |
| `driverRide.cancel.body.one` | 1 passenger will be told by email. |
| `driverRide.cancel.body.other` | {n} passengers will be told by email. |
| `driverRide.cancel.body.none` | No passengers have booked yet. |
| `driverRide.cancel.late` | Cancelling within 30 minutes of departure counts as a late cancellation on your profile. |
| `driverRide.cancel.confirm` | Cancel ride |
| `driverRide.cancel.keep` | Keep ride |
| `driverRide.cancel.toast` | Ride cancelled |
| `driverRide.cancelled` | You cancelled this ride |
| `driverRide.rate` | Rate {name} |
| `driverRide.fuelRule` | Prices are set by Haide and split fuel cost. Asking passengers for more is against the Terms of use. |

## 25. Ratings (E5-3)

Blind ratings: the other person sees yours once both are in, or after 7 days.

| Key | English |
|---|---|
| `rate.title` | Rate {name} |
| `rate.stars` | Your rating |
| `rate.star.one` | 1 star |
| `rate.star.other` | {n} stars |
| `rate.tags` | What stood out? |
| `rate.tag.punctual` | Punctual |
| `rate.tag.friendly` | Friendly |
| `rate.tag.safe` | Safe driving |
| `rate.tag.clean` | Clean car |
| `rate.tag.respectful` | Respectful |
| `rate.tag.onTime` | On time at pickup |
| `rate.submit` | Send rating |
| `rate.err` | Choose 1 to 5 stars. |
| `rate.window` | You can rate for 7 days after the ride. Ratings can’t be changed once sent. |
| `rate.done.title` | Rating sent |
| `rate.done.body` | {name} sees it once you’ve both rated, or after 7 days. |
| `rate.done.cta` | Back to My rides |
| `rate.toast` | Rating sent |

## 26. Report (E5-4)

Reasons match the backlog. The reported user is never told.

| Key | English |
|---|---|
| `report.title` | Report {name} |
| `report.body` | Tell us what happened. We review every report. {name} won’t be told that you reported them. |
| `report.reason` | Reason |
| `report.reason.noShow` | Didn’t show up |
| `report.reason.unsafe` | Unsafe driving |
| `report.reason.harassment` | Harassment |
| `report.reason.extraMoney` | Asked for extra money |
| `report.reason.fake` | Fake profile |
| `report.reason.other` | Other |
| `report.details` | Details |
| `report.details.hint` | {n} of 500 characters |
| `report.send` | Send report |
| `report.err` | Choose a reason. |
| `report.alsoBlock` | Also block {name} |
| `report.sent.title` | Report sent |
| `report.sent.body` | Thanks. We’ll review it. If someone is in danger, call 112. |
| `report.toast` | Report sent |

## 27. Block (E5-4)

Blocking is mutual: hidden rides and profiles, no bookings either way.

| Key | English |
|---|---|
| `block.title` | Block {name}? |
| `block.body` | You won’t see each other’s rides or profiles, and neither of you can request seats from the other. You can unblock in Settings. |
| `block.confirm` | Block {name} |
| `block.keep` | Don’t block |
| `block.toast` | {name} is blocked |
| `block.unblock` | Unblock |
| `block.unblocked` | {name} is unblocked |
| `block.empty` | You haven’t blocked anyone. |
| `block.title.list` | Blocked people |

## 28. Public profile (E1-5)

Rating shows only from 3 ratings. Never phone, plate or surname.

| Key | English |
|---|---|
| `pub.since` | Member since {month} |
| `pub.rating` | {r} from {n} ratings |
| `pub.new` | New to Haide |
| `pub.new.hint` | Ratings show after 3 ratings. |
| `pub.rides.one` | 1 ride completed |
| `pub.rides.other` | {n} rides completed |
| `pub.late` | Late cancellations, last 90 days |
| `pub.noShows` | No-shows, last 90 days |
| `pub.about` | About {name} |
| `pub.menu.report` | Report {name} |
| `pub.menu.block` | Block {name} |
| `pub.private` | Phone number and car plate are never shown on profiles. |

## 29. Own profile

| Key | English |
|---|---|
| `me.title` | Profile |
| `me.visitor.title` | Join your neighbours |
| `me.visitor.body` | Sign in to request seats or offer a ride. |
| `me.visitor.cta` | Sign in or create account |
| `me.viewPublic` | See how others see you |
| `me.edit` | Edit profile |
| `me.car` | My car |
| `me.car.none` | No car added yet |
| `me.settings` | Settings |
| `me.signOut` | Sign out |
| `me.signOut.toast` | Signed out |

## 30. Settings (E6)

| Key | English |
|---|---|
| `settings.title` | Settings |
| `settings.notifications` | Notifications |
| `settings.email` | Email updates |
| `settings.email.value` | Requests, answers and cancellations |
| `settings.push` | Push notifications |
| `settings.push.value` | Coming soon |
| `settings.language` | Language |
| `settings.language.value` | English |
| `settings.safety` | Safety |
| `settings.blocked` | Blocked people |
| `settings.privacy` | Privacy and data |
| `settings.policy` | Privacy policy |
| `settings.terms` | Terms of use |
| `settings.display` | Display |
| `settings.theme` | Theme |
| `settings.theme.system` | Auto |
| `settings.theme.dark` | Dark |
| `settings.theme.light` | Light |
| `settings.reduceMotion` | Reduce motion |
| `settings.reduceMotion.hint` | Stops moving lights and animations. Follows your phone until you change it here. |
| `settings.data` | Request a copy of my data |
| `settings.data.toast` | Request sent. We’ll email your data within 30 days. |
| `settings.delete` | Delete account |
| `settings.version` | Version {v} |

## 31. Delete account (E6-1)

States the consequences before the button.

| Key | English |
|---|---|
| `delete.title` | Delete your account? |
| `delete.body` | This can’t be undone. |
| `delete.l1` | Your upcoming rides and bookings are cancelled, and the people involved are told. |
| `delete.l2` | Your profile, photo, phone number and car disappear now and are erased within 30 days. |
| `delete.l3` | Ratings you gave stay, shown as “Deleted user”. Safety reports are kept for 12 months. |
| `delete.confirm` | Delete account |
| `delete.keep` | Keep my account |
| `delete.toast` | Account deleted. We erase your data within 30 days. |

## 32. Policy pages (E6-3)

Superseded by E6: the pages now render the full v1.1 text from `apps/web/src/features/policy/content/{terms,privacy}.en.ts` (lazy chunk, one `PolicyDoc` per document, locale suffix `.en`). Only the page chrome below lives in `en.json`; the legal text itself is not copy-deck material and changes only as a new version (see section 38). The short summaries listed here (`policy.privacy.p1` to `p4`, `policy.terms.p1` to `p4`, `policy.controller`, `policy.effective`) were removed from `en.json`.

| Key | English |
|---|---|
| `policy.privacy.title` | Privacy policy |
| `policy.terms.title` | Terms of use |
| `policy.version` | Version {v}, in force from {date} |
| `policy.controller` | Data controller: [name and address to be added before launch] |
| `policy.privacy.p1` | We use your name, photo, phone number and the places you travel between to run rides. We use your device location only when you tap “Use my location”, and only while the app is open. |
| `policy.privacy.p2` | Other people see approximate areas (about 300 m) until a seat is accepted. Exact points and your phone number are shared only with the people on your ride, until 24 hours after it. |
| `policy.privacy.p3` | Exact coordinates are reduced to neighbourhood level 90 days after a ride. Safety reports are kept for 12 months. Deleted accounts are erased within 30 days. |
| `policy.privacy.p4` | You can delete your account in Settings and ask for a copy of your data. You can complain to ANSPDCP, the Romanian data protection authority. |
| `policy.terms.p1` | Haide connects people travelling the same way inside and around Sibiu. You must be 18 or older. |
| `policy.terms.p2` | Drivers share the cost of a trip they are making anyway. The price shown in the app is the most a passenger should pay. Asking for more is not allowed and can lead to suspension. |
| `policy.terms.p3` | Haide doesn’t handle payments. Passengers pay drivers directly, in cash or by transfer, the amount shown in the app. |
| `policy.terms.p4` | Drivers can publish up to 4 rides a day with up to 4 passengers each. Be on time, be respectful, and tell us about anything unsafe. |

## 33. Errors and global messages

Pattern: what happened, then what to do. No apologies, no “Oops”, never “Something went wrong”.

| Key | English |
|---|---|
| `error.offline.banner` | You’re offline. Some things may not load. |
| `error.generic` | That didn’t work. Check your connection and try again. |
| `error.session` | You’ve been signed out. Sign in to continue. |
| `error.suspended` | Your account is paused after a report. Email support to find out why. |
| `error.notFound.title` | This page doesn’t exist |
| `error.notFound.body` | The link may be old. Start from Find. |
| `error.notFound.cta` | Go to Find |
| `error.fieldRequired` | Fill in this field. |
| `errors.PHOTO_INVALID` | We couldn’t read this photo. Choose a JPEG or PNG. |
| `errors.PHOTO_TOO_LARGE` | This photo is too large. Choose a smaller JPEG or PNG. |
| `errors.INVALID_STATE` | This ride can’t be changed any more. Go back to My rides to see where it stands. |
| `errors.ROUTING_UNAVAILABLE` | Our route service isn’t answering. Try again in a moment. |
| `errors.DAILY_RIDE_LIMIT` | You’ve reached 4 rides on that day. Choose another day. |

## 34. Notification emails (E4-6)

Neighbourhood labels only, never exact addresses, phone numbers or plates. Each email has one link into the app.

| Key | English |
|---|---|
| `email.request.subject` | {name} wants a seat on your {time} ride |
| `email.request.body` | {name} asked for a seat from {pickup} to {dropoff}. Answer by {deadline} or the request expires. Open Haide to decide. |
| `email.accepted.subject` | {driver} accepted your request |
| `email.accepted.body` | Pickup is near {pickup} at {time}. Open Haide for the exact point and contact details. |
| `email.rejected.subject` | {driver} can’t take you this time |
| `email.rejected.body` | Other rides on your route might fit. Open Haide to search again. |
| `email.expired.subject` | Your request for the {time} ride expired |
| `email.expired.body` | {driver} didn’t answer in time. Open Haide to find another ride. |
| `email.rideCancelled.subject` | {driver} cancelled the {time} ride |
| `email.rideCancelled.body` | The ride from {pickup} to {dropoff} won’t happen. Open Haide to find another ride. |
| `email.bookingCancelled.subject` | {name} cancelled their seat on your {time} ride |
| `email.bookingCancelled.body` | Your price per passenger is recalculated. It never goes up for passengers already accepted. |
| `email.priceDropped.body` | Price changed to {price} because a second passenger joined. |
| `email.signIn.subject` | Your Haide sign-in link |
| `email.signIn.body` | Tap the link to sign in. It works once and expires in 15 minutes. |

## 35. Accessibility labels

Screen-reader-only text and aria-labels.

| Key | English |
|---|---|
| `a11y.map.approx` | Map of the route. Pickup and drop-off are shown as approximate areas. |
| `a11y.map.exact` | Map of the route with the exact pickup and drop-off points. |
| `a11y.map.you` | Where you start |
| `a11y.avatar` | Photo of {name} |
| `a11y.rating` | {r} out of 5 |
| `a11y.progress` | Step {n} of {total} |
| `a11y.statusUpdated` | Status updated |
| `a11y.loading` | Loading |
| `a11y.priceDropped` | Price dropped |
| `a11y.openLink` | Opens in the same tab |
| `a11y.required` | required |

## 36. Keys with no screen in the prototype yet

These exist in the deck for states the build must handle but the prototype does not reach (or only reaches through a demo switch). `frontend-dev` implements them as written.

| Key | English |
|---|---|
| `app.tagline` | The neighbourly way across Sibiu. |
| `common.continue` | Continue |
| `common.edit` | Edit |
| `common.change` | Change |
| `common.min` | {n} min |
| `common.m` | {n} m |
| `common.approx` | Approximate |
| `place.permissionDenied` | Location is off for Haide. Search for an address instead. |
| `card.free` | Free ride |
| `detail.gone` | This ride is no longer available. It may have been cancelled or already left. |
| `detail.gone.cta` | Back to results |
| `request.err.full` | This ride just filled up. See other rides on your route. |
| `request.err.late` | This ride leaves in under 10 minutes, so requests are closed. |
| `request.err.limit` | You already have a request on this ride. |
| `auth.link.expired` | This link has expired or was already used. Request a new one. |
| `rideday.call112.hint` | For an emergency. |
| `driverRide.request.pays.one` | Pays {price} if alone |
| `driverRide.seats.full` | Ride is full |
| `error.generic` | That didn’t work. Check your connection and try again. |
| `error.session` | You’ve been signed out. Sign in to continue. |
| `error.suspended` | Your account is paused after a report. Email support to find out why. |
| `error.fieldRequired` | Fill in this field. |

## 37. Driver side of trust and safety (E5-2, E5-3, E5-4, E5-7)

The driver ride screen (`/driving/:id`) reuses the keys of sections 23 to 27: `rideday.call112`, `rideday.call112.hint` and `a11y.call112` (Call 112, shown from 15 minutes before to 2 hours after departure, window from the server), `rideday.noShow*` (Mark no-show sheet), `driverRide.rate` and `driverRide.pax.rated` (Rate), `driverRide.completed` (completed ride) and `driverRide.noShow.byPassenger` (a passenger reported that the driver did not show). The Report and Block buttons on a passenger card reuse `report.title` ("Report {name}") and `block.confirm` ("Block {name}"), so each button names the person. Rate opens the same Rate screen as the passenger side (section 25), with the passenger tags. New keys:

| Key | English |
|---|---|
| `driverRide.completed.none` | This ride is over. Nobody rode, so there is nothing to rate. |
| `driverRide.noShow.byYou` | You marked {name} as a no-show. |
| `driverRide.pax.noShow` | Marked as a no-show |
| `driverRide.pax.done` | Ride completed |
| `driverRide.pax.noShow.label` | Mark no-show for {name} |

Notes: `driverRide.pax.noShow.label` is the accessible name of the Mark no-show button; it starts with the visible text so voice control works. A no-show passenger shows no price and no phone. The "also block" choice lives in the Report sheet (`report.alsoBlock`); the separate Block button is for blocking without a report.

Also in this pass: the share button uses the Lucide `share` icon (was `swap`), and the rating confirmation keeps its heading (`<h2>`) inside a `role="status"` wrapper.


## 38. E6 additions (privacy and compliance)

Policy text (v1.1, effective 21 November 2026) lives in the content files named in section 32, marked "pending owner/counsel review". It covers, for the Terms: what Haide is, eligibility (18+, one account, driver licence and RCA), cost sharing (own trip, share of fuel or energy cost, no profit, pay at most the shown amount, no extra payments or tips, free rides allowed), ride limits (4 rides a day, 4 passengers, Sibiu area), bookings and ratings, conduct and 112, liability (counsel placeholder), account deletion, changes, Romanian law. For the Privacy policy: controller (placeholder), data collected, purposes and lawful bases, who sees what, processors and transfers, retention, rights, ANSPDCP contact, age, changes. Each file also carries a `changes` list shown on the updated-terms screen.

| Key | English |
|---|---|
| `consent.update.title` | We’ve updated our terms |
| `consent.update.body` | Read what changed, then accept to keep using Haide. |
| `consent.update.changes` | What changed |
| `consent.update.accept` | I accept the updated Terms of use and Privacy policy |
| `consent.update.err` | Accept the updated terms to continue. |
| `consent.update.readTerms` | Read the full Terms of use |
| `consent.update.readPrivacy` | Read the full Privacy policy |
| `consent.update.delete` | I’d rather delete my account |
| `consent.update.signOut` | Sign out |
| `delete.error` | We couldn’t delete your account. Try again. |
| `errors.ACCOUNT_DELETED` | This account was deleted. |
| `errors.CONFIRMATION_REQUIRED` | Confirm to continue. |
| `errors.TEMPORARILY_UNAVAILABLE` | We’re busy right now. Try again in a moment. |
| `settings.data.pending` | Request sent on {date}. We’ll reply by {due}. |
| `policy.toc` | Contents |
| `policy.loadError` | We couldn’t load this page. Check your connection and try again. |

Notes: the consent update mode (1.3b) shows no age checkbox; the button reuses `consent.cta`. `settings.data.pending` is shown in the Request row after a request and in the toast when the server returns an older open request (dates as "21 November 2026"). `errors.ACCOUNT_DELETED` was reworded from "has been deleted" to match the E6 spec. `delete.*`, `settings.data`, `settings.data.toast` and `settings.delete` are unchanged from sections 30 and 31; `settings.delete` is also the label of the Suspended screen link.
