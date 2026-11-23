import { assertPayloadSafe, type OutboxPayloadMap } from '../domain/outbox.ts';
import type { PUSH_TEMPLATES } from '../domain/push.ts';
import { isPushTemplate } from '../domain/push.ts';
import { BUCHAREST_TZ, bucharestTime } from '../domain/time.ts';
import { t, type MessageKey } from '../i18n/en.ts';
import { templateParts, type RenderContext, type TemplateInput } from './templates.ts';

/**
 * Push renderer (E8-4, ADR 0038): `{ title, body, path, tag }` for the lock screen. Area names and
 * local times only. It NEVER reads a first name: the payload fields that carry one are simply not
 * used here, so a name cannot reach a push service.
 */

export const PUSH_TITLE_MAX = 60;
export const PUSH_BODY_MAX = 160;
export const PUSH_MAX_BYTES = 3000;

export type PushMessage = { title: string; body: string; path: string; tag: string };

const dayFmt = new Intl.DateTimeFormat('en-GB', { timeZone: BUCHAREST_TZ, weekday: 'short' });

/** `ddd HH:mm` in Europe/Bucharest, e.g. `Fri 07:30`. */
export function pushTime(at: Date): string {
  return `${dayFmt.format(at)} ${bucharestTime(at)}`;
}

const str = (v: unknown, fallback: string): string =>
  typeof v === 'string' && v.trim() !== '' ? v : fallback;
const date = (v: unknown): Date => {
  const d = new Date(typeof v === 'string' ? v : NaN);
  return Number.isNaN(d.getTime()) ? new Date(0) : d;
};
const clip = (s: string, max: number): string => {
  const chars = [...s];
  return chars.length <= max ? s : `${chars.slice(0, max - 1).join('')}…`;
};

export type PushTemplateInput = Extract<
  TemplateInput,
  { template: (typeof PUSH_TEMPLATES)[number] }
>;

export function isPushInput(input: TemplateInput): input is PushTemplateInput {
  return isPushTemplate(input.template);
}

const SIBIU = 'Sibiu';

/** Throws for a template that has no push form. */
export function renderPush(input: TemplateInput, ctx: RenderContext): PushMessage {
  if (!isPushInput(input)) throw new Error('template has no push form');
  const { path } = templateParts(input, ctx);
  const key = (suffix: 'title' | 'body') => `push.${input.template}.${suffix}` as MessageKey;

  let vars: Record<string, string> = {};
  let id = '';
  switch (input.template) {
    case 'booking_requested':
    case 'booking_auto_confirmed':
    case 'ride_cancelled': {
      const p = input.payload as OutboxPayloadMap['booking_requested'];
      vars = {
        time: pushTime(date(p.departureAt)),
        pickup: str(p.pickupArea, SIBIU),
        dropoff: str(p.dropoffArea, SIBIU),
      };
      id = str(p.bookingId ?? (p as { rideId?: string }).rideId, '');
      break;
    }
    case 'booking_confirmed': {
      const p = input.payload;
      vars = { time: pushTime(date(p.pickupEtaAt)), pickup: str(p.pickupArea, SIBIU) };
      id = str(p.bookingId, '');
      break;
    }
    case 'booking_rejected': {
      id = str(input.payload.bookingId, '');
      break;
    }
    case 'booking_expired':
    case 'booking_cancelled': {
      const p = input.payload;
      vars = { time: pushTime(date(p.departureAt)) };
      id = str(p.bookingId, '');
      break;
    }
    case 'ride_updated': {
      const p = input.payload;
      vars = {
        time: pushTime(date(p.departureAt)),
        previous: pushTime(date(p.previousDepartureAt)),
        pickup: str(p.pickupArea, SIBIU),
        dropoff: str(p.dropoffArea, SIBIU),
      };
      id = str(p.bookingId, '');
      break;
    }
    case 'ride_alert_match': {
      const p = input.payload;
      vars = {
        time: pushTime(date(p.departureAt)),
        pickup: str(p.pickupArea, SIBIU),
        dropoff: str(p.dropoffArea, SIBIU),
      };
      id = str(p.alertId, '');
      break;
    }
  }

  let body = t(key('body'), vars);
  if (input.template === 'ride_alert_match') {
    const more = input.payload.moreCount;
    if (typeof more === 'number' && more > 0) {
      body += t('push.ride_alert_match.more', { count: String(more) });
    }
  }
  const message: PushMessage = {
    title: clip(t(key('title')), PUSH_TITLE_MAX),
    body: clip(body, PUSH_BODY_MAX),
    path,
    tag: `${input.template}:${id}`,
  };
  assertPushSafe(message);
  return message;
}

/** The payload guard of the outbox plus a size cap (a push service refuses large bodies). */
export function assertPushSafe(message: PushMessage): void {
  assertPayloadSafe(message);
  if (new TextEncoder().encode(JSON.stringify(message)).length > PUSH_MAX_BYTES) {
    throw new Error('push payload too large');
  }
}
