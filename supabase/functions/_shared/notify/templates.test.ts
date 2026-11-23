import { describe, expect, it } from 'vitest';
import { OUTBOX_TEMPLATES } from '../domain/outbox.ts';
import { renderEmail, whenLabel, type TemplateInput } from './templates.ts';

const NOW = new Date('2026-11-16T05:00:00Z'); // 07:00 in Bucharest (EET)
const ctx = { baseUrl: 'https://haide.ro/', now: NOW };
const DEP = '2026-11-16T07:30:00.000Z'; // today 09:30
const LATER = '2026-11-20T05:40:00.000Z'; // Fri 20 Nov, 07:40

const ALL: TemplateInput[] = [
  {
    template: 'booking_requested',
    payload: {
      bookingId: 'b1',
      rideId: 'r1',
      passengerFirstName: 'Ștefan',
      departureAt: DEP,
      pickupArea: 'Șelimbăr',
      dropoffArea: 'Cisnădie',
      expiresAt: '2026-11-16T05:30:00.000Z',
    },
  },
  {
    template: 'booking_confirmed',
    payload: {
      bookingId: 'b1',
      driverFirstName: 'Rădulescu',
      departureAt: DEP,
      pickupEtaAt: '2026-11-16T07:35:00.000Z',
      pickupArea: 'Șelimbăr',
    },
  },
  {
    template: 'booking_rejected',
    payload: { bookingId: 'b1', driverFirstName: 'Radu', departureAt: DEP },
  },
  {
    template: 'booking_expired',
    payload: { bookingId: 'b1', driverFirstName: 'Radu', departureAt: LATER },
  },
  {
    template: 'ride_cancelled',
    payload: {
      bookingId: 'b1',
      rideId: 'r1',
      driverFirstName: 'Radu',
      departureAt: DEP,
      pickupArea: 'Turnișor',
      dropoffArea: 'Piața Mare',
    },
  },
  {
    template: 'booking_cancelled',
    payload: { bookingId: 'b1', rideId: 'r1', passengerFirstName: 'Ioana', departureAt: LATER },
  },
  {
    template: 'rating_prompt',
    payload: { bookingId: 'b1', driverFirstName: 'Rădulescu', departureAt: DEP },
  },
  {
    template: 'rating_prompt_driver',
    payload: { rideId: 'r1', passengerCount: 2, departureAt: DEP },
  },
  {
    template: 'no_show_reported',
    payload: {
      bookingId: 'b1',
      rideId: 'r1',
      reporterFirstName: 'Ștefan',
      reporterRole: 'driver',
      departureAt: DEP,
    },
  },
  {
    template: 'no_show_reported',
    payload: {
      bookingId: 'b1',
      rideId: 'r1',
      reporterFirstName: 'Ioana',
      reporterRole: 'passenger',
      departureAt: DEP,
    },
  },
  { template: 'report_received', payload: { reportId: 'rep1', reason: 'unsafe_driving' } },
  {
    template: 'ride_cancelled',
    payload: {
      bookingId: 'b1',
      rideId: 'r1',
      driverFirstName: 'Radu',
      departureAt: DEP,
      pickupArea: 'Turnișor',
      dropoffArea: 'Piața Mare',
      by: 'system',
    },
  },
  {
    template: 'data_export_requested',
    payload: { requestId: 'req1', userId: 'u1', requestedAt: '2026-11-16T07:40:00.000Z' },
  },
  {
    template: 'data_export_ack',
    payload: { requestId: 'req1', dueBy: '2026-12-16T07:40:00.000Z' },
  },
  {
    template: 'account_suspended',
    payload: {
      reasonCode: 'harassment',
      statement: 'You sent repeated unwanted messages after a passenger asked you to stop.',
    },
  },
  { template: 'account_reinstated', payload: {} },
  {
    template: 'booking_auto_confirmed',
    payload: {
      bookingId: 'b1',
      rideId: 'r1',
      departureAt: LATER,
      pickupArea: 'Turnișor',
      dropoffArea: 'Piața Mare',
    },
  },
  {
    template: 'ride_alert_match',
    payload: {
      alertId: 'a1',
      rideId: 'r1',
      departureAt: LATER,
      pickupArea: 'Turnișor',
      dropoffArea: 'Piața Mare',
      moreCount: 2,
    },
  },
  {
    template: 'ride_updated',
    payload: {
      bookingId: 'b1',
      rideId: 'r1',
      driverFirstName: 'Rădulescu',
      previousDepartureAt: DEP,
      departureAt: LATER,
      pickupArea: 'Turnișor',
      dropoffArea: 'Piața Mare',
    },
  },
];

// Staff mailbox and suspended user get no app button.
const NO_BUTTON = new Set(['data_export_requested', 'account_suspended']);

const at = (i: number): TemplateInput => ALL[i] as TemplateInput;

describe('whenLabel', () => {
  it('shows the clock time today and the date otherwise, in Bucharest time', () => {
    expect(whenLabel(new Date(DEP), NOW)).toBe('09:30');
    expect(whenLabel(new Date(LATER), NOW)).toBe('Fri 20 Nov, 07:40');
  });
});

describe('renderEmail', () => {
  it('has a template for every outbox template', () => {
    expect([...new Set(ALL.map((i) => i.template))].sort()).toEqual([...OUTBOX_TEMPLATES].sort());
  });

  it('renders subject, text, html and an absolute link for each, with diacritics intact', () => {
    for (const input of ALL) {
      const out = renderEmail(input, ctx);
      expect(out.subject.length, input.template).toBeGreaterThan(5);
      if (!NO_BUTTON.has(input.template)) {
        expect(out.text, input.template).toContain(out.link);
        expect(out.html, input.template).toContain(`href="${out.link}"`);
      }
      expect(out.link.startsWith('https://haide.ro'), input.template).toBe(true);
      expect(out.link).not.toContain('//booking');
      expect(`${out.subject}${out.text}`).not.toMatch(/\{\w+\}|undefined|null/);
    }
  });

  it('links requests and cancelled seats to the ride, the rest to the booking', () => {
    const link = (i: number) => renderEmail(at(i), ctx).link;
    expect(link(0)).toBe('https://haide.ro/driving/r1');
    expect(link(1)).toBe('https://haide.ro/booking/b1');
    expect(link(2)).toBe('https://haide.ro/booking/b1');
    expect(link(3)).toBe('https://haide.ro/booking/b1');
    expect(link(4)).toBe('https://haide.ro/booking/b1');
    expect(link(5)).toBe('https://haide.ro/driving/r1');
  });

  it('ride_updated: shared layout, new and previous time, links to the booking, driver name from the payload', () => {
    const input = ALL.find((i) => i.template === 'ride_updated') as TemplateInput;
    const out = renderEmail(input, ctx);
    expect(out.subject).toBe('Rădulescu changed the time of your ride');
    expect(out.text).toContain(
      'Now leaving at Fri 20 Nov, 07:40 (was 09:30). Open Haide to check it still suits you, or cancel your seat.',
    );
    expect(out.link).toBe('https://haide.ro/booking/b1');
    expect(out.html).toContain('href="https://haide.ro/booking/b1"');
    expect(out.html).toContain('haide'); // the shared layout wordmark
    const anon = renderEmail(
      {
        template: 'ride_updated',
        payload: { ...(input.payload as object), driverFirstName: null },
      } as TemplateInput,
      ctx,
    );
    expect(anon.subject).toBe('Your driver changed the time of your ride');
  });

  it('uses the copy from docs/ux/copy.md section 34', () => {
    const req = renderEmail(at(0), ctx);
    expect(req.subject).toBe('Ștefan wants a seat on your 09:30 ride');
    expect(req.text).toContain(
      'Ștefan asked for a seat from Șelimbăr to Cisnădie. Answer by 07:30 or the request expires. Open Haide to decide.',
    );
    const acc = renderEmail(at(1), ctx);
    expect(acc.subject).toBe('Rădulescu accepted your request');
    expect(acc.text).toContain('Pickup is near Șelimbăr at 09:35.');
    expect(renderEmail(at(2), ctx).subject).toBe('Radu can’t take you this time');
    expect(renderEmail(at(3), ctx).subject).toBe(
      'Your request for the Fri 20 Nov, 07:40 ride expired',
    );
    expect(renderEmail(at(4), ctx).subject).toBe('Radu cancelled the 09:30 ride');
    expect(renderEmail(at(5), ctx).subject).toBe(
      'Ioana cancelled their seat on your Fri 20 Nov, 07:40 ride',
    );
  });

  it('E5 templates: prompts link to the rating, no-show goes to the absent party, system cancel is neutral', () => {
    const link = (i: number) => renderEmail(at(i), ctx).link;
    expect(link(6)).toBe('https://haide.ro/rate/b1');
    expect(renderEmail(at(6), ctx).subject).toBe('How was your ride with Rădulescu?');
    expect(link(7)).toBe('https://haide.ro/driving/r1');
    expect(renderEmail(at(8), ctx).subject).toBe('Ștefan reported a no-show on the 09:30 ride');
    expect(link(8)).toBe('https://haide.ro/booking/b1');
    expect(link(9)).toBe('https://haide.ro/driving/r1');
    expect(renderEmail(at(10), ctx).subject).toBe('New safety report: unsafe_driving');
    expect(renderEmail(at(11), ctx).subject).toBe('The 09:30 ride with Radu was cancelled');
    expect(renderEmail(at(11), ctx).text).not.toMatch(/suspend|blocked|report/i);
  });

  it('E6 templates: the support mail names the user id and the SQL, the ack promises 30 days', () => {
    const req = renderEmail(at(12), ctx);
    expect(req.subject).toBe('Data request req1');
    expect(req.text).toContain("select app.export_user_data('u1');");
    expect(req.text).toContain('Due by 2026-12-16.');
    const ack = renderEmail(at(13), ctx);
    expect(ack.subject).toBe('We got your request for a copy of your data');
    expect(ack.text).toContain('within 30 days');
    expect(ack.link).toBe('https://haide.ro/profile');
  });

  it('E7 templates: the suspension notice has the ground, the statement and how to appeal', () => {
    const out = renderEmail(at(14), ctx);
    expect(out.subject).toBe('Your Haide account is suspended');
    expect(out.text).toContain('Ground: Terms: harassment.');
    expect(out.text).toContain('You sent repeated unwanted messages');
    expect(out.text).toContain('A person reviewed this, it was not automatic.');
    expect(out.text).toContain('Your upcoming rides and bookings are cancelled.');
    expect(out.text).toContain('To appeal, reply to this email.');
    expect(out.html).toContain('<br>');
    expect(out.link).toBe('https://haide.ro');
    expect(renderEmail(at(15), ctx).subject).toBe('Your Haide account is active again');
    // The report queue link for the admins' notice.
    expect(renderEmail(at(10), ctx).link).toBe('https://haide.ro/admin/reports');
  });

  it('an unknown ground reads as other, and a hostile statement is escaped', () => {
    const out = renderEmail(
      {
        template: 'account_suspended',
        payload: { reasonCode: 'toString', statement: '<b>x</b> hello there' },
      },
      ctx,
    );
    expect(out.text).toContain('Ground: Terms: other conduct that breaks the rules.');
    expect(out.html).not.toContain('<b>x</b>');
  });

  it('never carries a coordinate, phone, plate or email address', () => {
    for (const input of ALL) {
      const out = renderEmail(input, ctx);
      const all = `${out.subject}\n${out.text}\n${out.html}`;
      expect(all).not.toMatch(/\d+\.\d{4,}/);
      expect(all).not.toMatch(/\+40|\b07\d{8}\b/);
      expect(all).not.toMatch(/\b[A-Z]{1,2}\s?\d{2,3}\s?[A-Z]{3}\b/);
      // Only the clearly marked placeholder contacts may appear.
      expect(all.replace(/\b(support|privacy)@haide\.example\b/g, '')).not.toMatch(
        /[^\s@]+@[^\s@]+\.[^\s@]+/,
      );
    }
  });

  it('survives a payload with missing or hostile fields (it comes from jsonb)', () => {
    const out = renderEmail(
      {
        template: 'booking_requested',
        payload: { passengerFirstName: '<script>alert(1)</script>' } as never,
      },
      ctx,
    );
    expect(out.html).not.toContain('<script>');
    expect(out.text).toContain('Sibiu');
  });

  it('falls back to neutral names', () => {
    const out = renderEmail(
      {
        template: 'booking_rejected',
        payload: { bookingId: 'b', driverFirstName: null, departureAt: DEP },
      },
      ctx,
    );
    expect(out.subject).toBe('Your driver can’t take you this time');
  });
});

describe('shared layout', () => {
  it('every template renders the wordmark, preheader, footer, button and text alternative', () => {
    for (const input of ALL) {
      const out = renderEmail(input, { ...ctx, supportEmail: 'help@haide.example' });
      const name = input.template;
      expect(out.html, name).toContain('name="color-scheme" content="light dark"');
      expect(out.html, name).toContain('prefers-color-scheme:dark');
      expect(out.html, name).toMatch(/>haide<span/);
      expect(out.html, name).toMatch(/<h1[^>]*>/);
      expect(out.html, name).toContain('display:none');
      expect(out.html, name).toContain('help@haide.example');
      expect(out.html, name).toContain('privacy@haide.example');
      expect(out.text, name).toContain('help@haide.example');
      expect(out.text, name).toContain(out.subject);
      if (NO_BUTTON.has(name)) {
        expect(out.html, name).not.toContain('Open Haide');
      } else {
        expect(out.html, name).toContain(`<a href="${out.link}"`);
        expect(out.html, name).toContain('<v:roundrect');
        expect(out.html, name).toContain('>Open Haide</a>');
        expect(out.html, name).toContain(`Or copy this link: ${out.link}`);
      }
    }
  });

  it('uses no images, no http links and no external resources', () => {
    for (const input of ALL) {
      const html = renderEmail(input, ctx).html;
      expect(html).not.toMatch(/<img|<link|<script|<iframe|url\(|@import|http:\/\//i);
      const urls = [...html.matchAll(/(?:src|href)="([^"]+)"/g)].map((m) => m[1] ?? '');
      expect(urls.every((u) => u.startsWith('https://haide.ro'))).toBe(true);
    }
  });

  it('escapes hostile dynamic values in the title, body and link', () => {
    const out = renderEmail(
      {
        template: 'booking_requested',
        payload: { passengerFirstName: '<b>"x"</b>', rideId: 'a"b' } as never,
      },
      ctx,
    );
    expect(out.html).not.toContain('<b>');
    expect(out.html).not.toContain('a"b');
    expect(out.html).toContain('&lt;b&gt;');
  });
});
