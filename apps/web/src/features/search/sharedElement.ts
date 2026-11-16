/**
 * Shared-element transition list -> details (motion.md moment 4). `view-transition-name` must be unique per state or
 * the browser skips the whole transition, so the list cards carry no names at rest: the tapped card is tagged on click
 * (every other name cleared first), and the details screen carries the same three names statically (`.vt-*` classes
 * in motion.css). Without View Transitions, or with reduced motion, navigation is simply instant.
 */
export type SharedPart = 'time' | 'route' | 'price';
const NAME: Record<SharedPart, string> = {
  time: 'ride-time',
  route: 'ride-route',
  price: 'ride-price',
};

export function tagCard(card: HTMLElement): void {
  document.querySelectorAll<HTMLElement>('[data-vt]').forEach((el) => {
    el.style.removeProperty('view-transition-name');
  });
  card.querySelectorAll<HTMLElement>('[data-vt]').forEach((el) => {
    const part = el.dataset.vt as SharedPart | undefined;
    if (part && NAME[part]) el.style.setProperty('view-transition-name', NAME[part]);
  });
}
