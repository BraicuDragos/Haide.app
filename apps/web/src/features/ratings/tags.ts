import type { RatingTag } from '@/api/types';
import type { MessageKey } from '@/i18n';

/**
 * Tags per ratee role (e5-trust-safety-spec section 3). A passenger rates a driver, a driver rates a passenger. The
 * server validates them again; this list only decides which chips to draw. Mirror of `RATING_TAGS` in the contracts.
 */
export const RATING_TAGS: Record<'driver' | 'passenger', RatingTag[]> = {
  driver: ['punctual', 'friendly', 'safe_driving', 'clean_car'],
  passenger: ['punctual', 'friendly', 'respectful', 'on_time_at_pickup'],
};

export const TAG_LABEL: Record<RatingTag, MessageKey> = {
  punctual: 'rate.tag.punctual',
  friendly: 'rate.tag.friendly',
  safe_driving: 'rate.tag.safe',
  clean_car: 'rate.tag.clean',
  respectful: 'rate.tag.respectful',
  on_time_at_pickup: 'rate.tag.onTime',
};
