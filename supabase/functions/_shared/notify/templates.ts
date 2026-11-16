import { bucharestDayKey, bucharestTime, BUCHAREST_TZ } from '../domain/time.ts';
import type { OutboxPayloadMap, OutboxTemplate } from '../domain/outbox.ts';
import { t } from '../i18n/en.ts';

/**
 * Email templates (E4-6, e4-bookings-spec §6.1). Pure: payload in, subject, text, html and link out.
 * The payload holds ids, ISO times, first names and area names only, so nothing here can leak an
 * exact address, phone or plate. Times are shown in Europe/Bucharest. No images, no tracking pixels.
 */

export type TemplateInput = {
  [K in OutboxTemplate]: { template: K; payload: OutboxPayloadMap[K] };
}[OutboxTemplate];

export type RenderContext = {
  /** `APP_BASE_URL`, without a trailing slash handling needed (normalised here). */
  baseUrl: string;
  /** Decides whether a time carries a date ("today" shows the clock time only). */
  now: Date;
};

export type RenderedEmail = {
  subject: string;
  text: string;
  html: string;
  /** Absolute link into the app. */
  link: string;
};

const dateFmt = new Intl.DateTimeFormat('en-GB', {
  timeZone: BUCHAREST_TZ,
  weekday: 'short',
  day: 'numeric',
  month: 'short',
});

/** `HH:MM` today in Bucharest, else `Fri 20 Nov, HH:MM`. */
export function whenLabel(at: Date, now: Date): string {
  const time = bucharestTime(at);
  if (bucharestDayKey(at) === bucharestDayKey(now)) return time;
  return `${dateFmt.format(at).replace(',', '')}, ${time}`;
}

const escapeHtml = (s: string): string =>
  s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');

/** Untrusted jsonb: take a string or fall back. */
const str = (v: unknown, fallback: string): string =>
  typeof v === 'string' && v.trim() !== '' ? v : fallback;

const date = (v: unknown): Date => {
  const d = new Date(typeof v === 'string' ? v : NaN);
  return Number.isNaN(d.getTime()) ? new Date(0) : d;
};

const SIBIU = 'Sibiu';

type Parts = { subject: string; body: string; path: string };

function parts(input: TemplateInput, ctx: RenderContext): Parts {
  switch (input.template) {
    case 'booking_requested': {
      const p = input.payload;
      return {
        subject: t('email.request.subject', {
          name: str(p.passengerFirstName, t('email.fallback.passenger')),
          time: whenLabel(date(p.departureAt), ctx.now),
        }),
        body: t('email.request.body', {
          name: str(p.passengerFirstName, t('email.fallback.passenger')),
          pickup: str(p.pickupArea, SIBIU),
          dropoff: str(p.dropoffArea, SIBIU),
          deadline: whenLabel(date(p.expiresAt), ctx.now),
        }),
        path: `/driving/${encodeURIComponent(str(p.rideId, ''))}`,
      };
    }
    case 'booking_confirmed': {
      const p = input.payload;
      return {
        subject: t('email.accepted.subject', {
          driver: str(p.driverFirstName, t('email.fallback.driver')),
        }),
        body: t('email.accepted.body', {
          pickup: str(p.pickupArea, SIBIU),
          time: whenLabel(date(p.pickupEtaAt), ctx.now),
        }),
        path: `/booking/${encodeURIComponent(str(p.bookingId, ''))}`,
      };
    }
    case 'booking_rejected': {
      const p = input.payload;
      return {
        subject: t('email.rejected.subject', {
          driver: str(p.driverFirstName, t('email.fallback.driver')),
        }),
        body: t('email.rejected.body'),
        path: `/booking/${encodeURIComponent(str(p.bookingId, ''))}`,
      };
    }
    case 'booking_expired': {
      const p = input.payload;
      return {
        subject: t('email.expired.subject', { time: whenLabel(date(p.departureAt), ctx.now) }),
        body: t('email.expired.body', {
          driver: str(p.driverFirstName, t('email.fallback.driver')),
        }),
        path: `/booking/${encodeURIComponent(str(p.bookingId, ''))}`,
      };
    }
    case 'ride_cancelled': {
      const p = input.payload;
      const subjectVars = {
        driver: str(p.driverFirstName, t('email.fallback.driver')),
        time: whenLabel(date(p.departureAt), ctx.now),
      };
      return {
        // A system cancellation (suspension) gets the neutral wording: it never says why.
        subject:
          p.by === 'system'
            ? t('email.rideCancelled.system.subject', subjectVars)
            : t('email.rideCancelled.subject', subjectVars),
        body: t('email.rideCancelled.body', {
          pickup: str(p.pickupArea, SIBIU),
          dropoff: str(p.dropoffArea, SIBIU),
        }),
        path: `/booking/${encodeURIComponent(str(p.bookingId, ''))}`,
      };
    }
    case 'booking_cancelled': {
      const p = input.payload;
      return {
        subject: t('email.bookingCancelled.subject', {
          name: str(p.passengerFirstName, t('email.fallback.passenger')),
          time: whenLabel(date(p.departureAt), ctx.now),
        }),
        body: t('email.bookingCancelled.body'),
        path: `/driving/${encodeURIComponent(str(p.rideId, ''))}`,
      };
    }
    case 'rating_prompt': {
      const p = input.payload;
      const driver = str(p.driverFirstName, t('email.fallback.driver'));
      return {
        subject: t('email.ratePrompt.subject', { driver }),
        body: t('email.ratePrompt.body', { driver }),
        path: `/rate/${encodeURIComponent(str(p.bookingId, ''))}`,
      };
    }
    case 'rating_prompt_driver': {
      const p = input.payload;
      return {
        subject: t('email.ratePromptDriver.subject', {
          time: whenLabel(date(p.departureAt), ctx.now),
        }),
        body: t('email.ratePromptDriver.body'),
        path: `/driving/${encodeURIComponent(str(p.rideId, ''))}`,
      };
    }
    case 'no_show_reported': {
      const p = input.payload;
      const reporterIsDriver = p.reporterRole === 'driver';
      return {
        subject: t('email.noShow.subject', {
          name: str(
            p.reporterFirstName,
            t(reporterIsDriver ? 'email.fallback.driver' : 'email.fallback.passenger'),
          ),
          time: whenLabel(date(p.departureAt), ctx.now),
        }),
        body: t('email.noShow.body'),
        // The absent party is the other one: a passenger opens the booking, a driver the ride.
        path: reporterIsDriver
          ? `/booking/${encodeURIComponent(str(p.bookingId, ''))}`
          : `/driving/${encodeURIComponent(str(p.rideId, ''))}`,
      };
    }
    case 'report_received': {
      const p = input.payload;
      return {
        subject: t('email.report.subject', { reason: str(p.reason, 'other') }),
        body: t('email.report.body'),
        // E7 adds the reports queue. Until then the link is the app root.
        path: '',
      };
    }
  }
}

export function renderEmail(input: TemplateInput, ctx: RenderContext): RenderedEmail {
  const { subject, body, path } = parts(input, ctx);
  const link = `${ctx.baseUrl.replace(/\/+$/, '')}${path}`;
  const openLine = t('email.open', { link });
  const footer = t('email.footer');
  const text = `${body}\n\n${openLine}\n\n--\n${footer}\n`;
  const html =
    `<!doctype html><html lang="en"><body style="font-family:system-ui,sans-serif;line-height:1.5">` +
    `<p>${escapeHtml(body)}</p>` +
    `<p><a href="${escapeHtml(link)}">${escapeHtml(t('email.openLabel'))}</a></p>` +
    `<p style="color:#666;font-size:12px">${escapeHtml(footer)}</p></body></html>`;
  return { subject, text, html, link };
}
