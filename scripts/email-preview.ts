/**
 * Render every transactional email template to tmp/email-preview/ so the owner can eyeball them.
 *
 *   pnpm email:preview      (node --experimental-strip-types scripts/email-preview.ts)
 *
 * Imports only the pure renderer: nothing is sent, no network, no database. Sample data is fake.
 * Open tmp/email-preview/index.html: each template is shown in a 360 px (phone) and a 600 px frame.
 */
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { OUTBOX_TEMPLATES } from '../supabase/functions/_shared/domain/outbox.ts';
import {
  renderEmail,
  type RenderContext,
  type TemplateInput,
} from '../supabase/functions/_shared/notify/templates.ts';

const now = new Date('2026-11-16T05:00:00Z');
const ctx: RenderContext = { baseUrl: 'https://haide.example', now };
const dep = '2026-11-16T07:30:00.000Z';
const later = '2026-11-20T05:40:00.000Z';

const samples: TemplateInput[] = [
  {
    template: 'booking_requested',
    payload: {
      bookingId: 'b-1001',
      rideId: 'r-2001',
      passengerFirstName: 'Ioana',
      departureAt: dep,
      pickupArea: 'Turnisor',
      dropoffArea: 'Piata Mare',
      expiresAt: '2026-11-16T05:30:00.000Z',
    },
  },
  {
    template: 'booking_confirmed',
    payload: {
      bookingId: 'b-1001',
      driverFirstName: 'Radu',
      departureAt: dep,
      pickupEtaAt: '2026-11-16T07:35:00.000Z',
      pickupArea: 'Selimbar',
    },
  },
  {
    template: 'booking_rejected',
    payload: { bookingId: 'b-1001', driverFirstName: 'Radu', departureAt: dep },
  },
  {
    template: 'booking_expired',
    payload: { bookingId: 'b-1001', driverFirstName: 'Radu', departureAt: later },
  },
  {
    template: 'ride_cancelled',
    payload: {
      bookingId: 'b-1001',
      rideId: 'r-2001',
      driverFirstName: 'Radu',
      departureAt: dep,
      pickupArea: 'Turnisor',
      dropoffArea: 'Piata Mare',
    },
  },
  {
    template: 'booking_cancelled',
    payload: {
      bookingId: 'b-1001',
      rideId: 'r-2001',
      passengerFirstName: 'Ioana',
      departureAt: later,
    },
  },
  {
    template: 'rating_prompt',
    payload: { bookingId: 'b-1001', driverFirstName: 'Radu', departureAt: dep },
  },
  {
    template: 'rating_prompt_driver',
    payload: { rideId: 'r-2001', passengerCount: 2, departureAt: dep },
  },
  {
    template: 'no_show_reported',
    payload: {
      bookingId: 'b-1001',
      rideId: 'r-2001',
      reporterFirstName: 'Radu',
      reporterRole: 'driver',
      departureAt: dep,
    },
  },
  { template: 'report_received', payload: { reportId: 'rep-1', reason: 'unsafe_driving' } },
  {
    template: 'data_export_requested',
    payload: { requestId: 'req-1', userId: 'u-1', requestedAt: '2026-11-16T07:40:00.000Z' },
  },
  {
    template: 'data_export_ack',
    payload: { requestId: 'req-1', dueBy: '2026-12-16T07:40:00.000Z' },
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
      bookingId: 'b-1001',
      rideId: 'r-2001',
      departureAt: later,
      pickupArea: 'Turnisor',
      dropoffArea: 'Piata Mare',
    },
  },
  {
    template: 'ride_alert_match',
    payload: {
      alertId: 'a-1',
      rideId: 'r-2001',
      departureAt: later,
      pickupArea: 'Turnisor',
      dropoffArea: 'Piata Mare',
      moreCount: 2,
    },
  },
];

const missing = OUTBOX_TEMPLATES.filter((n) => !samples.some((s) => s.template === n));
if (missing.length > 0) throw new Error(`email-preview has no sample for: ${missing.join(', ')}`);

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const out = join(root, 'tmp', 'email-preview');
await mkdir(out, { recursive: true });

const rows: string[] = [];
for (const s of samples) {
  const r = renderEmail(s, ctx);
  const name = s.template;
  await writeFile(join(out, `${name}.html`), r.html, 'utf8');
  await writeFile(join(out, `${name}.txt`), `Subject: ${r.subject}\n\n${r.text}`, 'utf8');
  const frame = (w: number) =>
    `<iframe src="${name}.html" width="${w}" height="760" title="${name} ${w}px" style="border:1px solid #888;background:#fff"></iframe>`;
  rows.push(
    `<section><h2>${name}</h2><p>Subject: <b>${r.subject.replace(/</g, '&lt;')}</b> · <a href="${name}.txt">text</a></p>` +
      `<div style="display:flex;gap:16px;flex-wrap:wrap">${frame(360)}${frame(600)}</div></section>`,
  );
}
const index =
  `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Haide email preview</title>` +
  `<meta name="color-scheme" content="light dark">` +
  `<style>body{font-family:system-ui,sans-serif;margin:16px}section{margin:0 0 32px}</style></head><body>` +
  `<h1>Haide email preview</h1><p>${samples.length} samples, fake data. Switch your OS to dark mode and reload to see the dark styles (iframes follow the OS setting).</p>` +
  rows.join('') +
  `</body></html>`;
await writeFile(join(out, 'index.html'), index, 'utf8');
console.log(`Wrote ${samples.length} previews to ${out}`);
