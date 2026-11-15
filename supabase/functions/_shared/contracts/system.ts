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
  sent: z.number().int(),
  failed: z.number().int(),
});
export type TickResponse = z.infer<typeof tickResponseSchema>;
