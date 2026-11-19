import { z } from 'zod';

export const healthResponseSchema = z.object({
  status: z.enum(['ok', 'degraded']),
  db: z.enum(['ok', 'down']),
  version: z.string(),
});
export type HealthResponse = z.infer<typeof healthResponseSchema>;

// POST /telemetry/error (truncated and scrubbed server-side)
export const telemetryErrorBodySchema = z.object({
  message: z.string().min(1).max(2000),
  stack: z.string().max(20000).optional(),
  route: z.string().max(200).optional(),
  appVersion: z.string().max(64).optional(),
});
export type TelemetryErrorBody = z.infer<typeof telemetryErrorBodySchema>;

export const tickResponseSchema = z.object({
  expired: z.number().int(),
  /** Rides moved to `completed` or `expired` by the completion step (E5). */
  completed: z.number().int(),
  /** Bookings cancelled by the safety sweep: blocks and suspensions (E5). */
  swept: z.number().int(),
  sent: z.number().int(),
  failed: z.number().int(),
  /** Route previews, expired share links and hourly housekeeping rows deleted. */
  purged: z.number().int(),
  /** Rides plus bookings whose exact locations were coarsened (E6). */
  coarsened: z.number().int(),
  /** Account deletions finished (storage object and auth user removed) (E6). */
  accountsPurged: z.number().int(),
  /** Alert notifications queued by the alert matcher (E8). */
  alertsMatched: z.number().int(),
  /** Push messages delivered, and push rows that ended in failure (E8). */
  pushSent: z.number().int(),
  pushFailed: z.number().int(),
});
export type TickResponse = z.infer<typeof tickResponseSchema>;
