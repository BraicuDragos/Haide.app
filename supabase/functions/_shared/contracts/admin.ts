import { z } from 'zod';
import { fuelTypeSchema } from './account.ts';
import { reportReasonSchema } from './safety.ts';

/**
 * Admin contracts (E7, e7-metrics-admin-spec §6). All routes need an active account with role `admin`
 * (anonymous 401, a plain user 403 FORBIDDEN, a suspended admin 403 ACCOUNT_SUSPENDED) and share the
 * `admin` rate limit (120 per minute). Shared with the web app (import through @contracts).
 * STABLE: additive changes only.
 *
 *   GET  /admin/metrics?week=2026-W47
 *   GET  /admin/reports?status=open|dismissed|actioned|all&limit&cursor
 *   POST /admin/reports/{id}/dismiss            -> 204
 *   POST /admin/users/{id}/suspend              -> 204
 *   POST /admin/users/{id}/unsuspend            -> 204
 *   GET  /admin/users?status=suspended
 *   GET  /admin/energy-prices
 *   POST /admin/energy-prices                   -> 201 { item }
 *   GET  /admin/ops
 *   GET  /admin/errors?limit=50
 *
 * No admin response ever holds a phone number, plate, email or coordinates (data-model §5.2).
 *
 * Error codes (api-contract §1.1), no new ones except LARGE_CHANGE (already in the list):
 * - metrics: 400 `fields.week` (malformed, before 2026-W46 or after the current week).
 * - reports: 400 `fields.status|limit|cursor`. dismiss: 404 unknown report, 409 INVALID_STATE (not open).
 * - suspend: 400 `fields.userId = self`, `fields.reportId = mismatch`; 404 unknown user or report;
 *   409 INVALID_STATE (user not active, or report not open). unsuspend: 404, 409 INVALID_STATE.
 * - energy: 400 VALIDATION_FAILED (`fields.effectiveFrom` = past | too_far | not_after_latest),
 *   409 LARGE_CHANGE (`fields.priceMilli` and/or `fields.consumptionCenti` = large_change).
 */

// ---- shared ----------------------------------------------------------------------------------------------

export const adminUserStatusSchema = z.enum(['active', 'suspended', 'deleted']);

/** A person as an admin sees them: first name and photo, counts, never contact details. */
export const adminUserRefSchema = z.object({
  id: z.uuid(),
  /** Null for a deleted user without a report snapshot. */
  firstName: z.string().nullable(),
  photoUrl: z.string().nullable(),
  status: adminUserStatusSchema,
  /** `YYYY-MM`. */
  memberSince: z.string().regex(/^\d{4}-\d{2}$/),
  ridesCompleted: z.number().int(),
  /** Reports about this user in the last 90 days. */
  reports90d: z.number().int(),
});
export type AdminUserRef = z.infer<typeof adminUserRefSchema>;

// ---- GET /admin/metrics ---------------------------------------------------------------------------------

export const metricStatusSchema = z.enum(['on_target', 'between', 'below_kill', 'no_data']);
export type MetricStatus = z.infer<typeof metricStatusSchema>;

/**
 * `value` is null without data. Rates are fractions (0.312 = 31.2 %); `medianResponseMin` is minutes,
 * `reportsPer100` is reports per 100 completed rides, `northStar` is a seat count. `n` is the
 * denominator (the count for the North Star). `status` is judged against `target` and `kill` in the
 * metric's own direction (see METRIC_TARGETS in domain/metrics.ts).
 */
export const metricSchema = z.object({
  value: z.number().nullable(),
  target: z.number(),
  kill: z.number(),
  status: metricStatusSchema,
  n: z.number().int(),
});
export type Metric = z.infer<typeof metricSchema>;

export const corridorMetricSchema = z.object({
  corridor: z.enum(['south', 'west', 'campus', 'other']),
  value: z.number().nullable(),
  searches: z.number().int(),
});

export const adminMetricsQuerySchema = z.object({
  /** ISO week `YYYY-Www`. Default: the current week in Europe/Bucharest. */
  week: z.string().max(10).optional(),
});

export const adminMetricsResponseSchema = z.object({
  week: z.string().regex(/^\d{4}-W\d{2}$/),
  /** Monday 00:00 Europe/Bucharest of the week, and of the next one (UTC ISO instants). */
  from: z.string(),
  to: z.string(),
  /** True while the week is still running (`now < to`). */
  partial: z.boolean(),
  northStar: metricSchema,
  matchRate: z.object({
    /** All searches. */
    overall: metricSchema,
    /** South + west + campus: the target applies to this one. */
    launch: metricSchema,
    byCorridor: z.array(corridorMetricSchema),
  }),
  fillRate: metricSchema,
  medianResponseMin: metricSchema,
  retention4w: metricSchema.extend({
    /** The ISO week the cohort first rode in (the selected week minus 4). */
    cohortWeek: z.string(),
    /** False while the 28-day window is still open (show "provisional"). */
    closed: z.boolean(),
  }),
  reportsPer100: metricSchema,
  cancellationRate: metricSchema,
  /** The last 12 weeks ending at the selected week, oldest first, zeros included. */
  series: z.array(z.object({ week: z.string(), completedSeats: z.number().int() })),
  flags: z.object({
    highVolumeDrivers: z.array(
      z.object({ user: adminUserRefSchema, completed7d: z.number().int() }),
    ),
  }),
});
export type AdminMetricsResponse = z.infer<typeof adminMetricsResponseSchema>;

// ---- GET /admin/reports ------------------------------------------------------------------------------------

export const ADMIN_REPORT_STATUSES = ['open', 'dismissed', 'actioned', 'all'] as const;
export const adminReportStatusSchema = z.enum(ADMIN_REPORT_STATUSES);

export const ADMIN_REPORTS_DEFAULT_LIMIT = 20;
export const ADMIN_REPORTS_MAX_LIMIT = 50;

export const adminReportsQuerySchema = z.object({
  status: adminReportStatusSchema.default('open'),
  limit: z.coerce
    .number()
    .int()
    .min(1)
    .max(ADMIN_REPORTS_MAX_LIMIT)
    .default(ADMIN_REPORTS_DEFAULT_LIMIT),
  cursor: z.string().max(200).optional(),
});

export const adminActionKindSchema = z.enum([
  'suspend',
  'unsuspend',
  'dismiss_report',
  'energy_price_added',
]);

export const adminReportItemSchema = z.object({
  id: z.uuid(),
  status: z.enum(['open', 'dismissed', 'actioned']),
  reason: reportReasonSchema,
  details: z.string().nullable(),
  createdAt: z.string(),
  resolvedAt: z.string().nullable(),
  reporter: adminUserRefSchema,
  reported: adminUserRefSchema.extend({ openReports: z.number().int() }),
  /** Area names only. */
  ride: z
    .object({
      id: z.uuid(),
      departureAt: z.string(),
      fromArea: z.string().nullable(),
      toArea: z.string().nullable(),
    })
    .nullable(),
  bookingId: z.uuid().nullable(),
  /** The last 5 admin actions about the reported user, newest first. */
  history: z.array(
    z.object({
      action: adminActionKindSchema,
      adminFirstName: z.string().nullable(),
      at: z.string(),
      note: z.string().nullable(),
    }),
  ),
});
export type AdminReportItem = z.infer<typeof adminReportItemSchema>;

export const adminReportsResponseSchema = z.object({
  items: z.array(adminReportItemSchema),
  nextCursor: z.string().nullable(),
});
export type AdminReportsResponse = z.infer<typeof adminReportsResponseSchema>;

// ---- dismiss, suspend, unsuspend ------------------------------------------------------------------------

export const ADMIN_NOTE_MAX = 200;
export const SUSPEND_STATEMENT_MIN = 10;
export const SUSPEND_STATEMENT_MAX = 300;

/** POST /admin/reports/{id}/dismiss and POST /admin/users/{id}/unsuspend. */
export const adminNoteBodySchema = z.object({ note: z.string().max(1000).optional() });
export type AdminNoteBody = z.input<typeof adminNoteBodySchema>;

/**
 * POST /admin/users/{id}/suspend. `statement` (NFC, trimmed, 10..300 characters counted in code points)
 * is the statement of reasons the user receives by email (DSA Art. 17). Length is checked in the
 * service so the answer carries `fields.statement`.
 */
export const suspendBodySchema = z.object({
  reasonCode: reportReasonSchema,
  statement: z.string().max(2000),
  reportId: z.uuid().optional(),
});
export type SuspendBody = z.input<typeof suspendBodySchema>;

// ---- GET /admin/users ------------------------------------------------------------------------------------------

export const adminUsersQuerySchema = z.object({
  status: z.literal('suspended').default('suspended'),
});

export const adminSuspendedItemSchema = z.object({
  user: adminUserRefSchema,
  suspendedAt: z.string(),
  reasonCode: reportReasonSchema.nullable(),
  statement: z.string().nullable(),
  adminFirstName: z.string().nullable(),
});
export const adminUsersResponseSchema = z.object({ items: z.array(adminSuspendedItemSchema) });
export type AdminUsersResponse = z.infer<typeof adminUsersResponseSchema>;

// ---- energy prices ------------------------------------------------------------------------------------------------

export const energyPriceSchema = z.object({
  id: z.uuid(),
  fuelType: fuelTypeSchema,
  /** Milli-RON per litre or kWh (9810 = 9.81 RON). */
  priceMilli: z.number().int(),
  /** Per 100 km, times 100 (700 = 7.00). */
  consumptionCenti: z.number().int(),
  unit: z.enum(['l', 'kWh']),
  effectiveFrom: z.string(),
  sourceNote: z.string().nullable(),
  createdBy: z.object({ id: z.uuid(), firstName: z.string().nullable() }).nullable(),
  createdAt: z.string(),
});
export type EnergyPrice = z.infer<typeof energyPriceSchema>;

export const energyPricesResponseSchema = z.object({
  fuels: z.array(
    z.object({
      fuelType: fuelTypeSchema,
      unit: z.enum(['l', 'kWh']),
      current: energyPriceSchema,
      /** The next row with `effectiveFrom` in the future, if any. */
      scheduled: energyPriceSchema.nullable(),
    }),
  ),
  /** The last 50 versions across all fuels, newest first. */
  history: z.array(energyPriceSchema),
});
export type EnergyPricesResponse = z.infer<typeof energyPricesResponseSchema>;

export const ENERGY_PRICE_LIMITS = {
  priceMilli: { min: 100, max: 50_000 },
  consumptionCenti: { min: 100, max: 5_000 },
  sourceNoteMax: 200,
} as const;

/**
 * POST /admin/energy-prices. No `unit`: it follows from the fuel type (electric is kWh, the rest l).
 * Range, schedule and large-change rules are checked by the service (domain/energyPrices.ts) so each
 * failure carries its own `fields` value.
 */
export const createEnergyPriceBodySchema = z.object({
  fuelType: fuelTypeSchema,
  priceMilli: z.number().int(),
  consumptionCenti: z.number().int(),
  /** ISO instant. Default now, truncated to the minute. */
  effectiveFrom: z.string().max(40).optional(),
  sourceNote: z.string().max(1000),
  overrideLargeChange: z.boolean().optional(),
});
export type CreateEnergyPriceBody = z.input<typeof createEnergyPriceBodySchema>;
export const createEnergyPriceResponseSchema = z.object({ item: energyPriceSchema });
export type CreateEnergyPriceResponse = z.infer<typeof createEnergyPriceResponseSchema>;

// ---- GET /admin/ops ---------------------------------------------------------------------------------------------------

export const adminOpsResponseSchema = z.object({
  dbSizeMb: z.number(),
  emailsToday: z.number().int(),
  emailCap: z.number().int(),
  outboxPending: z.number().int(),
  outboxFailed24h: z.number().int(),
  /** About the openrouteservice calls today: the sum of `ridePreview` rate-limit counts since UTC midnight. */
  routePreviewsToday: z.number().int(),
  errors24h: z.number().int(),
  openReports: z.number().int(),
  openDataRequests: z.number().int(),
  overdueDeletions: z.number().int(),
  cron: z.array(z.object({ job: z.string(), status: z.string(), startedAt: z.string() })),
});
export type AdminOpsResponse = z.infer<typeof adminOpsResponseSchema>;

// ---- GET /admin/errors -----------------------------------------------------------------------------------------------

export const adminErrorsQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(50),
});

export const adminErrorsResponseSchema = z.object({
  /** No stack and no user hash. */
  items: z.array(
    z.object({
      id: z.number().int(),
      source: z.enum(['client', 'server']),
      message: z.string(),
      route: z.string().nullable(),
      appVersion: z.string().nullable(),
      createdAt: z.string(),
    }),
  ),
});
export type AdminErrorsResponse = z.infer<typeof adminErrorsResponseSchema>;
