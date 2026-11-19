import { z } from 'zod';
import { latLngSchema } from './geo.ts';
import { rideOwnerViewSchema, rideSeriesSchema, weekdaySchema } from './rides.ts';

/**
 * Liquidity-booster contracts (E8, e8-liquidity-spec §7): ride series, ride alerts, auto-accept,
 * web push and the monthly stats. Shared with the web app (import through @contracts). STABLE:
 * additive changes only. Money is integer bani, times ISO 8601 UTC, local times `HH:MM`
 * (Europe/Bucharest), local dates `YYYY-MM-DD`.
 *
 * Request bodies are deliberately loose here (types only): the field-level rules live in
 * `_shared/domain/{series,alerts,push}.ts` so the error codes are exactly the documented ones
 * (`fields.weekdays = invalid`, `fields.endsOn = too_far`, ...), not zod issue codes.
 */

export const LIQUIDITY_LIMITS = {
  seriesMaxDays: 28,
  seriesStartMaxDays: 14,
  alertsMaxActive: 5,
  alertTtlDays: 14,
  alertDateAheadDays: 14,
  alertLabelMax: 80,
  pushSubsMaxPerUser: 5,
} as const;

// ---- Building blocks ---------------------------------------------------------------------------------

export const alertScheduleSchema = z.union([
  z.object({ kind: z.literal('date'), date: z.string() }),
  z.object({ kind: z.literal('weekly'), weekdays: z.array(weekdaySchema) }),
]);
export type AlertSchedule = z.infer<typeof alertScheduleSchema>;

export const alertWindowSchema = z.union([z.literal(15), z.literal(30), z.literal(60)]);

export const rideAlertSchema = z.object({
  id: z.uuid(),
  from: latLngSchema,
  to: latLngSchema,
  fromLabel: z.string(),
  toLabel: z.string(),
  schedule: alertScheduleSchema,
  time: z.string(),
  windowMin: alertWindowSchema,
  createdAt: z.string(),
  expiresAt: z.string(),
  lastNotifiedAt: z.string().nullable(),
  matchesSent: z.number().int().min(0),
});
export type RideAlert = z.infer<typeof rideAlertSchema>;

export const SKIP_CODES = ['DAILY_RIDE_LIMIT', 'DEPARTURE_TOO_SOON', 'INVALID_TIME'] as const;
export const skipCodeSchema = z.enum(SKIP_CODES);
export type SkipCode = z.infer<typeof skipCodeSchema>;

// ---- POST /ride-series ----------------------------------------------------------------------------------
// Gates: consent + complete profile + vehicle. Rate limit `ridePublish`. No price field exists.

export const createSeriesBodySchema = z.object({
  previewId: z.uuid(),
  weekdays: z.array(z.number()).max(50),
  departureTime: z.string().max(10),
  startsOn: z.string().max(10).optional(),
  endsOn: z.string().max(10),
  seats: z.number().int().min(1).max(4),
  note: z.string().trim().max(200).nullish(),
  isFree: z.boolean().default(false),
  autoAccept: z.boolean().default(false),
});
export type CreateSeriesBody = z.input<typeof createSeriesBodySchema>;
export type CreateSeriesRequest = z.output<typeof createSeriesBodySchema>;

export const createSeriesResponseSchema = z.object({
  series: rideSeriesSchema,
  created: z.array(z.object({ rideId: z.uuid(), departureAt: z.string() })),
  skipped: z.array(z.object({ date: z.string(), code: skipCodeSchema })),
});
export type CreateSeriesResponse = z.infer<typeof createSeriesResponseSchema>;

// ---- POST /ride-series/{id}/cancel ---------------------------------------------------------------------

export const cancelSeriesBodySchema = z.object({}).strict();

export const cancelSeriesResponseSchema = z.object({
  series: rideSeriesSchema,
  cancelledRideIds: z.array(z.uuid()),
});
export type CancelSeriesResponse = z.infer<typeof cancelSeriesResponseSchema>;

// ---- PATCH /me/rides/{id} ------------------------------------------------------------------------------------

export const patchRideBodySchema = z.object({ autoAccept: z.boolean() }).strict();
export type PatchRideBody = z.infer<typeof patchRideBodySchema>;
export const patchRideResponseSchema = rideOwnerViewSchema;

// ---- Alerts: POST /alerts, GET /me/alerts, DELETE /alerts/{id} ----------------------------------------------

export const createAlertBodySchema = z.object({
  from: latLngSchema,
  to: latLngSchema,
  fromLabel: z.string().max(1000).default(''),
  toLabel: z.string().max(1000).default(''),
  schedule: z.union([
    z.object({ kind: z.literal('date'), date: z.string().max(10) }),
    z.object({ kind: z.literal('weekly'), weekdays: z.array(z.number()).max(50) }),
  ]),
  time: z.string().max(10),
  windowMin: z.number(),
});
export type CreateAlertBody = z.input<typeof createAlertBodySchema>;
export type CreateAlertRequest = z.output<typeof createAlertBodySchema>;

export const createAlertResponseSchema = z.object({ item: rideAlertSchema });
export type CreateAlertResponse = z.infer<typeof createAlertResponseSchema>;

export const alertListResponseSchema = z.object({ items: z.array(rideAlertSchema) });
export type AlertListResponse = z.infer<typeof alertListResponseSchema>;

// ---- Push: GET /push/config, PUT|DELETE /me/push-subscription -------------------------------------------------

export const pushConfigResponseSchema = z.object({ vapidPublicKey: z.string().nullable() });
export type PushConfigResponse = z.infer<typeof pushConfigResponseSchema>;

/** The browser's `PushSubscription.toJSON()`. Field rules (host allow-list, key lengths) are in domain/push.ts. */
export const putPushSubscriptionBodySchema = z.object({
  endpoint: z.string().max(2000),
  keys: z.object({ p256dh: z.string().max(200), auth: z.string().max(100) }),
  expirationTime: z.number().nullish(),
});
export type PutPushSubscriptionBody = z.infer<typeof putPushSubscriptionBodySchema>;

export const deletePushSubscriptionBodySchema = z.object({
  endpoint: z.string().max(2000).optional(),
});
export type DeletePushSubscriptionBody = z.infer<typeof deletePushSubscriptionBodySchema>;

// ---- GET /me/stats/month ---------------------------------------------------------------------------------------

export const monthStatsQuerySchema = z.object({ month: z.string().max(10).optional() });

export const monthStatsResponseSchema = z.object({
  /** `YYYY-MM`. */
  month: z.string(),
  /** Local first day of the month and of the next one (`YYYY-MM-DD`). */
  from: z.string(),
  to: z.string(),
  driver: z.object({
    sharedFuelCostBani: z.number().int().min(0),
    passengersCarried: z.number().int().min(0),
    ridesCompleted: z.number().int().min(0),
  }),
  passenger: z.object({
    paidBani: z.number().int().min(0),
    ridesCompleted: z.number().int().min(0),
  }),
});
export type MonthStatsResponse = z.infer<typeof monthStatsResponseSchema>;
