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
});
export type TickResponse = z.infer<typeof tickResponseSchema>;
