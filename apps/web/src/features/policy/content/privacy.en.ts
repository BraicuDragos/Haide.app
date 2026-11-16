import type { PolicyDoc } from './types';

/** Privacy policy v1.1. Drafted from the DPIA; pending owner and counsel review before launch. */
export const privacy: PolicyDoc = {
  version: '1.1',
  effectiveDate: '2026-11-21',
  changes: [
    'Who is responsible for your data, why we use it and on what legal basis.',
    'How long we keep each kind of data, including 90 days for exact locations.',
    'Your rights, how to delete your account and how to ask for a copy of your data.',
    'Who processes data for us and how to complain to the data protection authority.',
  ],
  sections: [
    {
      id: 'controller',
      title: 'Who is responsible',
      body: [
        'Data controller: [name, registration number and address to be added before launch]. Contact for anything about your data: privacy@haide.example.',
      ],
    },
    {
      id: 'data',
      title: 'What we collect',
      body: [
        'Account: your email, first name, phone number, optional photo and short bio, and your consent records.',
        'Car (drivers): make, model, colour, plate, fuel type and seats.',
        'Rides and bookings: pickup and drop-off points, route, times, prices, notes, status, ratings, reports and blocks.',
        'Device location: only when you tap “Use my location”, and only while the app is open. We do not track you in the background.',
        'Technical: error logs and a few anonymous usage events, without advertising identifiers.',
      ],
    },
    {
      id: 'purposes',
      title: 'Why we use it and on what basis',
      body: [
        'To run your account and the rides you take part in. Basis: performing the contract (Terms of use).',
        'To keep people safe, prevent fraud and abuse, secure the service and understand how it is used in aggregate. Basis: our legitimate interest.',
        'To use your device location for the place you choose. Basis: your consent, which you give by tapping the button and can withdraw by turning location off.',
        'To meet legal obligations, such as keeping consent records. Basis: legal obligation.',
        'We show no advertising, we do not sell data, and we make no automated decisions that have legal effect on you.',
      ],
    },
    {
      id: 'sharing',
      title: 'Who sees what',
      body: [
        'Other people see your first name, photo, bio, rating and counts of cancellations and no-shows.',
        'Before a seat is accepted, others see approximate areas of about 300 m, not exact points.',
        'After acceptance, the driver and passenger on that ride see each other’s exact pickup point and phone number, until 24 hours after the ride.',
        'A trip link you share lets the person with the link follow that trip for a limited time.',
      ],
    },
    {
      id: 'processors',
      title: 'Processors and transfers',
      body: [
        'We use service providers that process data on our instructions: hosting and database (Supabase), email delivery, and map and route services based on OpenStreetMap data.',
        'Where a provider is outside the European Economic Area, transfers rely on the safeguards the law requires, such as standard contractual clauses. [Provider list and regions to be confirmed before launch.]',
        'Local storage in your browser keeps the app working (sign-in, theme, drafts). It is functional only.',
      ],
    },
    {
      id: 'retention',
      title: 'How long we keep it',
      body: [
        'Exact locations of a ride and its bookings are reduced to neighbourhood level 90 days after the ride, and notes and the plate are removed.',
        'Deleted accounts: profile, photo, phone number, bio and car are removed at once and erased within 30 days at most. Ratings stay and show “Deleted user”.',
        'Safety reports are kept for 12 months, together with the name and phone number the reported person had when the report was made, even if that account is deleted in the meantime. Moderator actions are kept for 24 months. Consent records are kept for 3 years after deletion.',
        'Usage events are kept for 13 months, error logs for 14 days and email notifications for 30 days.',
      ],
    },
    {
      id: 'rights',
      title: 'Your rights',
      body: [
        'You can ask for access to your data, correction, erasure, restriction, a portable copy, and you can object to uses based on our legitimate interest. You can withdraw consent at any time.',
        'Delete your account in Settings. Use “Request a copy of my data” in Settings and we email it to you within one month.',
        'You can also write to privacy@haide.example. We reply within one month.',
      ],
    },
    {
      id: 'complaints',
      title: 'Complaints',
      body: [
        'You can complain to the Romanian data protection authority, ANSPDCP: B-dul G-ral. Gheorghe Magheru 28-30, Sector 1, 010336 București, anspdcp@dataprotection.ro, dataprotection.ro.',
      ],
    },
    {
      id: 'age',
      title: 'Age',
      body: [
        'Haide is for people aged 18 and over. We do not knowingly keep data about anyone younger.',
      ],
    },
    {
      id: 'changes',
      title: 'Changes to this policy',
      body: [
        'When we change this policy we publish a new version, say what changed, and ask you to accept it the next time you sign in.',
      ],
    },
  ],
};
