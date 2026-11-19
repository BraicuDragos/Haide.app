/**
 * Moment that may earn the push pre-prompt: the first booking request or the first publish went through (E8-4).
 * This tiny module is all the entry chunk carries; the sheet and the push code load only when it fires.
 */
let due = false;
const listeners = new Set<() => void>();

export function triggerPushPrompt(): void {
  due = true;
  listeners.forEach((l) => l());
}
export function clearPushPrompt(): void {
  due = false;
  listeners.forEach((l) => l());
}
export const pushPromptDue = (): boolean => due;
export function subscribePushPrompt(cb: () => void): () => void {
  listeners.add(cb);
  return () => listeners.delete(cb);
}
