/** Injected time source. Domain code never calls Date.now(). */
export interface Clock {
  now(): Date;
}

/** Deterministic clock for tests and replays. */
export function fixedClock(at: Date | string): Clock {
  const t = new Date(at).getTime();
  return { now: () => new Date(t) };
}
