import { z } from 'zod';

/** WGS84 point. Exact coordinates carry 5 decimals (about 1 m). */
export const latLngSchema = z.object({
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
});
export type LatLng = z.infer<typeof latLngSchema>;

export const placeKindSchema = z.enum(['street', 'poi', 'address', 'area']);

export const placeSchema = z.object({
  id: z.string(),
  name: z.string(),
  secondary: z.string(),
  kind: placeKindSchema,
  point: latLngSchema,
  areaName: z.string(),
});
export type Place = z.infer<typeof placeSchema>;

// GET /places?q=&limit=
export const placesQuerySchema = z.object({
  q: z.string().trim().min(2).max(80),
  limit: z.coerce.number().int().min(1).max(8).default(8),
});
export const placesResponseSchema = z.object({ items: z.array(placeSchema) });

// POST /places/reverse
export const reverseBodySchema = z.object({ point: latLngSchema });
export const reverseResponseSchema = z.object({ place: placeSchema });
