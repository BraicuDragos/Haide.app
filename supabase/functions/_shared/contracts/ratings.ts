import { z } from 'zod';

/**
 * Small building blocks shared by the ride, booking and safety contracts (E5). Kept in their own
 * file so rides.ts and bookings.ts can use them without an import cycle. Import through
 * `safety.ts` or the contracts index, which re-export everything here.
 */

/** Tags a passenger gives a driver, and tags a driver gives a passenger (e5 spec §3). */
export const RATING_TAGS = {
  driver: ['punctual', 'friendly', 'safe_driving', 'clean_car'],
  passenger: ['punctual', 'friendly', 'respectful', 'on_time_at_pickup'],
} as const;

export const RATING_TAG_VALUES = [
  'punctual',
  'friendly',
  'safe_driving',
  'clean_car',
  'respectful',
  'on_time_at_pickup',
] as const;
export const ratingTagSchema = z.enum(RATING_TAG_VALUES);
export type RatingTag = z.infer<typeof ratingTagSchema>;

export const RATING_LIMITS = { minStars: 1, maxStars: 5, maxTags: 4 } as const;

/** The viewer's own rating of a booking. Never says whether the counterpart rated. */
export const ratingGivenSchema = z.object({
  stars: z.number().int().min(1).max(5),
  tags: z.array(ratingTagSchema),
  createdAt: z.string(),
});
export type RatingGiven = z.infer<typeof ratingGivenSchema>;

/**
 * The window in which the "Call 112" button shows: `from <= now < until`, computed by the server
 * (departure minus 15 min to departure plus 2 h). The client only compares the clock to the bounds.
 */
export const call112WindowSchema = z.object({ from: z.string(), until: z.string() });
export type Call112Window = z.infer<typeof call112WindowSchema>;
