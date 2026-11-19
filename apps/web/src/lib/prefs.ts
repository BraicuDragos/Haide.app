import { useSyncExternalStore } from 'react';

/**
 * Display preferences: theme and motion. One source of truth for both CSS and JS:
 * `<html data-theme="dark|light">` and `<html data-motion="reduced|full">`, set before first paint by
 * public/theme-init.js (same keys, same rules) and kept in sync here.
 *
 * - Theme: dark unless the user chose otherwise. No stored choice = dark whatever the OS says (ADR 0016); the stored
 *   value 'system' is the explicit Auto choice and follows the OS.
 * - Motion: the in-app switch overrides the OS setting (WCAG 2.2.2); without a stored choice the OS wins.
 * localStorage can throw or be empty (private mode, blocked data): every access is in try/catch and the app works
 * without it.
 */
export type ThemePref = 'system' | 'dark' | 'light';
export type MotionPref = 'system' | 'reduced' | 'full';

const THEME_KEY = 'haide.theme';
const MOTION_KEY = 'haide.motion';

// When storage is blocked the choice still applies (and is remembered) for this visit.
const memory = new Map<string, string>();

function read(key: string): string | null {
  try {
    return window.localStorage.getItem(key) ?? memory.get(key) ?? null;
  } catch {
    return memory.get(key) ?? null;
  }
}
function write(key: string, value: string | null) {
  if (value === null) memory.delete(key);
  else memory.set(key, value);
  try {
    if (value === null) window.localStorage.removeItem(key);
    else window.localStorage.setItem(key, value);
  } catch {
    /* not persisted: the in-memory copy keeps the choice for this visit */
  }
}
const mq = (q: string) => {
  try {
    return window.matchMedia(q).matches;
  } catch {
    return false;
  }
};

export function readThemePref(): ThemePref {
  const v = read(THEME_KEY);
  return v === 'system' || v === 'light' ? v : 'dark';
}
export function readMotionPref(): MotionPref {
  const v = read(MOTION_KEY);
  return v === 'reduced' || v === 'full' ? v : 'system';
}

export const resolveTheme = (p: ThemePref): 'dark' | 'light' =>
  p === 'system' ? (mq('(prefers-color-scheme: light)') ? 'light' : 'dark') : p;
export const resolveMotion = (p: MotionPref): 'reduced' | 'full' =>
  p === 'system' ? (mq('(prefers-reduced-motion: reduce)') ? 'reduced' : 'full') : p;

/** True when motion is reduced (OS or in-app switch). JS animations check this before starting. */
export const reducedMotion = (): boolean => document.documentElement.dataset.motion === 'reduced';

const listeners = new Set<() => void>();
const notify = () => listeners.forEach((l) => l());

/** Browser chrome follows the theme: the colour is read from the token role, not typed here. */
function syncThemeColour() {
  const bg = getComputedStyle(document.documentElement).getPropertyValue('--theme-bg').trim();
  if (!bg) return;
  document
    .querySelectorAll<HTMLMetaElement>('meta[name="theme-color"]')
    .forEach((m) => m.setAttribute('content', bg));
}

export function applyTheme(p: ThemePref = readThemePref()) {
  document.documentElement.dataset.theme = resolveTheme(p);
  syncThemeColour();
}
export function applyMotion(p: MotionPref = readMotionPref()) {
  const next = resolveMotion(p);
  document.documentElement.dataset.motion = next;
  // Base CSS is the calm final state, so cancelling running animations leaves a correct screen.
  if (next === 'reduced') document.getAnimations?.().forEach((a) => a.cancel());
}

export function setThemePref(p: ThemePref) {
  write(THEME_KEY, p);
  applyTheme(p);
  notify();
}
export function setMotionPref(p: MotionPref) {
  write(MOTION_KEY, p === 'system' ? null : p);
  applyMotion(p);
  notify();
}

/** Call once at startup: re-syncs the attributes and follows OS changes while the choice is "system". */
export function initPrefs() {
  applyTheme();
  applyMotion();
  try {
    window.matchMedia('(prefers-color-scheme: light)').addEventListener('change', () => {
      if (readThemePref() === 'system') {
        applyTheme();
        notify();
      }
    });
    window.matchMedia('(prefers-reduced-motion: reduce)').addEventListener('change', () => {
      if (readMotionPref() === 'system') {
        applyMotion();
        notify();
      }
    });
  } catch {
    /* matchMedia unavailable */
  }
}

const subscribe = (cb: () => void) => {
  listeners.add(cb);
  return () => listeners.delete(cb);
};
export const useThemePref = () => useSyncExternalStore(subscribe, readThemePref, () => 'system');
export const useMotionPref = () => useSyncExternalStore(subscribe, readMotionPref, () => 'system');
/** Re-renders when motion is switched; read the value with `reducedMotion()`. */
export const useReducedMotion = () =>
  useSyncExternalStore(
    subscribe,
    () => document.documentElement.dataset.motion === 'reduced',
    () => false,
  );

/**
 * Push pre-prompt "Not now" (E8-4): the moment it was dismissed, kept on this device. The sheet stays away for 30 days
 * (it is a polite ask, not a nag). Storage can fail: then the memory copy holds for this visit.
 */
const PUSH_PROMPT_KEY = 'haide.pushPrompt';
export const PUSH_PROMPT_SNOOZE_MS = 30 * 24 * 3_600_000;

export function readPushPromptDismissedAt(): number | null {
  const n = Number(read(PUSH_PROMPT_KEY));
  return Number.isFinite(n) && n > 0 ? n : null;
}
export function snoozePushPrompt(now: number = Date.now()): void {
  write(PUSH_PROMPT_KEY, String(now));
}
export function pushPromptSnoozed(now: number = Date.now()): boolean {
  const at = readPushPromptDismissedAt();
  return at !== null && now - at < PUSH_PROMPT_SNOOZE_MS;
}
