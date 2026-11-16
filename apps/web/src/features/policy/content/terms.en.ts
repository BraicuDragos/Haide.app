import type { PolicyDoc } from './types';

/** Terms of use v1.1. Drafted from the product rules; pending owner and counsel review before launch. */
export const terms: PolicyDoc = {
  version: '1.1',
  effectiveDate: '2026-11-21',
  changes: [
    'The cost-sharing rules are now written out in full: no profit, no extra payments.',
    'Ride limits are stated: up to 4 rides a day and up to 4 passengers.',
    'Bookings, cancellations, no-shows, ratings, reports and blocks are covered.',
    'Account deletion and what we keep afterwards are described.',
  ],
  sections: [
    {
      id: 'what-haide-is',
      title: 'What Haide is',
      body: [
        'Haide connects people who are travelling the same way inside and around Sibiu. A driver publishes a trip they are making anyway, and passengers ask for a seat on it.',
        'Haide is not a transport operator and does not provide transport. We do not take payments and we are not a party to the agreement between a driver and a passenger. We provide the app that lets you find each other.',
      ],
    },
    {
      id: 'eligibility',
      title: 'Who can use Haide',
      body: [
        'You must be 18 or older, have one account only, and give true details. Your phone number must be your own.',
        'Drivers must hold a valid driving licence, have valid RCA insurance for the car, and drive a roadworthy car.',
      ],
    },
    {
      id: 'cost-sharing',
      title: 'Cost sharing',
      body: [
        'A ride on Haide is the driver’s own trip, one they would make anyway. Passengers share the cost of that trip. It is not a taxi service and not a business.',
        'Haide works out the price as a share of the fuel or energy cost of the trip. The driver makes no profit from a ride.',
        'A passenger pays at most the amount shown in the app, directly to the driver, in cash or by transfer. Drivers must not ask for extra payments, surcharges or tips. Free rides are allowed.',
        'Asking for more than the shown price can lead to suspension of the account.',
      ],
    },
    {
      id: 'ride-limits',
      title: 'Ride limits',
      body: [
        'A driver can publish up to 4 rides a day, with up to 4 passengers on each ride.',
        'Haide is for trips in the Sibiu area. Rides outside it are not available.',
      ],
    },
    {
      id: 'bookings',
      title: 'Bookings, cancellations and ratings',
      body: [
        'A passenger asks for a seat and the driver accepts or declines. An accepted seat is a commitment on both sides.',
        'Cancel as early as you can. Late cancellations and no-shows are recorded and shown on your profile as counts, so others can decide.',
        'After a ride, both people can rate each other. Ratings stay hidden until both have rated or the rating window closes.',
      ],
    },
    {
      id: 'conduct',
      title: 'Conduct and safety',
      body: [
        'Be on time, be respectful, and do not harass or discriminate. Do not use Haide for anything illegal.',
        'You can report a person and you can block a person. Exact pickup points and phone numbers are shared only between the people on an accepted ride.',
        'In an emergency call 112. Haide is not an emergency service.',
        'We may pause or close an account after a report, or if these terms are broken.',
      ],
    },
    {
      id: 'liability',
      title: 'Liability and consumer law',
      body: [
        'Each person is responsible for their own conduct and for the trip they make. Haide is not responsible for the actions of drivers or passengers, or for losses during a ride, within what the law allows.',
        'Nothing here limits rights you have under mandatory consumer law. [Liability wording to be confirmed by counsel before launch.]',
      ],
    },
    {
      id: 'deleting',
      title: 'Deleting your account',
      body: [
        'You can delete your account at any time in Settings. Your upcoming rides and bookings are cancelled and the people involved are told.',
        'Your profile, photo, phone number and car are removed and erased within 30 days. Ratings stay and show “Deleted user”. Safety reports about you are kept for 12 months. The privacy policy has the details.',
      ],
    },
    {
      id: 'changes',
      title: 'Changes to these terms',
      body: [
        'When we change these terms we publish a new version and ask you to accept it the next time you sign in. If you do not agree, you can delete your account.',
      ],
    },
    {
      id: 'law',
      title: 'Governing law and contact',
      body: [
        'These terms are governed by Romanian law. Questions: privacy@haide.example. [Company details to be added before launch.]',
      ],
    },
  ],
};
