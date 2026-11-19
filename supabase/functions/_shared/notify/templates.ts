import { dataRequestDueBy } from '../domain/privacy.ts';
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

const GROUND_KEYS = {
  no_show: 'email.ground.no_show',
  unsafe_driving: 'email.ground.unsafe_driving',
  harassment: 'email.ground.harassment',
  extra_money: 'email.ground.extra_money',
  fake_profile: 'email.ground.fake_profile',
  other: 'email.ground.other',
} as const;

/** The ToS ground for a report reason code; anything unknown reads as "other". */
function groundLabel(code: unknown): string {
  const key = typeof code === 'string' && Object.hasOwn(GROUND_KEYS, code) ? code : 'other';
  return t(GROUND_KEYS[key as keyof typeof GROUND_KEYS]);
}

export type Parts = { subject: string; body: string; path: string };

/** Subject, body and in-app path of a template. The push renderer reuses the path. */
export function templateParts(input: TemplateInput, ctx: RenderContext): Parts {
  return parts(input, ctx);
}

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
        path: '/admin/reports',
      };
    }
    case 'data_export_requested': {
      const p = input.payload;
      const requestedAt = date(p.requestedAt);
      return {
        subject: t('email.dataRequest.subject', { requestId: str(p.requestId, 'unknown') }),
        body: t('email.dataRequest.body', {
          requestId: str(p.requestId, 'unknown'),
          userId: str(p.userId, 'unknown'),
          requestedAt: requestedAt.toISOString(),
          dueBy: dataRequestDueBy(requestedAt).toISOString().slice(0, 10),
        }),
        // The support mailbox gets no app link that would imply a user action.
        path: '',
      };
    }
    case 'account_suspended': {
      const p = input.payload;
      return {
        subject: t('email.suspended.subject'),
        body: t('email.suspended.body', {
          ground: groundLabel(p.reasonCode),
          statement: str(p.statement, ''),
        }),
        // Nothing to open: a suspended account cannot use the app. The link is the app root.
        path: '',
      };
    }
    case 'account_reinstated':
      return {
        subject: t('email.reinstated.subject'),
        body: t('email.reinstated.body'),
        path: '',
      };
    case 'booking_auto_confirmed': {
      const p = input.payload;
      return {
        subject: t('email.autoConfirmed.subject', {
          time: whenLabel(date(p.departureAt), ctx.now),
        }),
        body: t('email.autoConfirmed.body', {
          pickup: str(p.pickupArea, SIBIU),
          dropoff: str(p.dropoffArea, SIBIU),
        }),
        path: `/driving/${encodeURIComponent(str(p.rideId, ''))}`,
      };
    }
    case 'ride_alert_match': {
      const p = input.payload;
      const more = typeof p.moreCount === 'number' && p.moreCount > 0 ? p.moreCount : 0;
      return {
        subject: t('email.alertMatch.subject', {
          fromArea: str(p.pickupArea, SIBIU),
          toArea: str(p.dropoffArea, SIBIU),
        }),
        body:
          t('email.alertMatch.body', {
            time: whenLabel(date(p.departureAt), ctx.now),
            pickup: str(p.pickupArea, SIBIU),
            dropoff: str(p.dropoffArea, SIBIU),
          }) + (more > 0 ? ` ${t('email.alertMatch.more', { count: String(more) })}` : ''),
        // The deep link re-runs the match with the alert's own points (web, E8-2).
        path: `/ride/${encodeURIComponent(str(p.rideId, ''))}?alert=${encodeURIComponent(str(p.alertId, ''))}`,
      };
    }
    case 'data_export_ack':
      return {
        subject: t('email.dataAck.subject'),
        body: t('email.dataAck.body'),
        path: '/profile',
      };
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
    `<p>${escapeHtml(body).replace(/\n/g, '<br>')}</p>` +
    `<p><a href="${escapeHtml(link)}">${escapeHtml(t('email.openLabel'))}</a></p>` +
    `<p style="color:#666;font-size:12px">${escapeHtml(footer)}</p></body></html>`;
  return { subject, text, html, link };
}
