import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  applyMotion,
  applyTheme,
  readMotionPref,
  readThemePref,
  reducedMotion,
  resolveMotion,
  resolveTheme,
  setMotionPref,
  setThemePref,
} from './prefs';

function mockMedia(matches: Record<string, boolean>) {
  vi.stubGlobal('matchMedia', (q: string) => ({
    matches: matches[q] ?? false,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
  }));
}

beforeEach(() => {
  window.localStorage.clear();
  delete document.documentElement.dataset.theme;
  delete document.documentElement.dataset.motion;
  mockMedia({});
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('theme', () => {
  it('is dark by default, even when the OS asks for light', () => {
    mockMedia({ '(prefers-color-scheme: light)': true });
    expect(readThemePref()).toBe('dark');
    applyTheme();
    expect(document.documentElement.dataset.theme).toBe('dark');
  });
  it('resolves Auto from the OS, dark and light literally', () => {
    expect(resolveTheme('system')).toBe('dark');
    mockMedia({ '(prefers-color-scheme: light)': true });
    expect(resolveTheme('system')).toBe('light');
    expect(resolveTheme('dark')).toBe('dark');
  });
  it('persists every choice, Auto included, and applies it to <html>', () => {
    mockMedia({ '(prefers-color-scheme: light)': true });
    setThemePref('light');
    expect(window.localStorage.getItem('haide.theme')).toBe('light');
    expect(readThemePref()).toBe('light');
    expect(document.documentElement.dataset.theme).toBe('light');
    setThemePref('system'); // an explicit choice: follows the OS (light here)
    expect(window.localStorage.getItem('haide.theme')).toBe('system');
    expect(readThemePref()).toBe('system');
    expect(document.documentElement.dataset.theme).toBe('light');
    setThemePref('dark');
    expect(document.documentElement.dataset.theme).toBe('dark');
  });
});

describe('motion', () => {
  it('follows the OS until the in-app switch overrides it', () => {
    mockMedia({ '(prefers-reduced-motion: reduce)': true });
    expect(resolveMotion('system')).toBe('reduced');
    applyMotion();
    expect(reducedMotion()).toBe(true);
    setMotionPref('full'); // the switch beats the OS (WCAG 2.2.2 needs a way to choose)
    expect(reducedMotion()).toBe(false);
    expect(readMotionPref()).toBe('full');
    setMotionPref('reduced');
    expect(reducedMotion()).toBe(true);
    expect(window.localStorage.getItem('haide.motion')).toBe('reduced');
  });
});

describe('storage failures', () => {
  it('works when localStorage throws', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    expect(readThemePref()).toBe('dark');
    expect(() => setThemePref('light')).not.toThrow();
    expect(document.documentElement.dataset.theme).toBe('light');
    applyTheme();
  });
});

describe('public/theme-init.js (runs before first paint)', () => {
  const code = readFileSync(join(import.meta.dirname, '../../public/theme-init.js'), 'utf8');
  const run = () => (0, eval)(code);

  it('sets dark and full motion by default', () => {
    run();
    expect(document.documentElement.dataset.theme).toBe('dark');
    expect(document.documentElement.dataset.motion).toBe('full');
  });
  it('honours stored choices over the OS', () => {
    mockMedia({ '(prefers-color-scheme: light)': true, '(prefers-reduced-motion: reduce)': true });
    window.localStorage.setItem('haide.theme', 'dark');
    window.localStorage.setItem('haide.motion', 'full');
    run();
    expect(document.documentElement.dataset.theme).toBe('dark');
    expect(document.documentElement.dataset.motion).toBe('full');
  });
  it('stays dark without a stored choice even if the OS asks for light; motion follows the OS', () => {
    mockMedia({ '(prefers-color-scheme: light)': true, '(prefers-reduced-motion: reduce)': true });
    run();
    expect(document.documentElement.dataset.theme).toBe('dark');
    expect(document.documentElement.dataset.motion).toBe('reduced');
  });
  it('follows the OS when the user explicitly chose Auto', () => {
    mockMedia({ '(prefers-color-scheme: light)': true });
    window.localStorage.setItem('haide.theme', 'system');
    run();
    expect(document.documentElement.dataset.theme).toBe('light');
  });
});

describe('push pre-prompt snooze', () => {
  it('stays away for 30 days after "Not now", then asks again', async () => {
    const { pushPromptSnoozed, snoozePushPrompt, PUSH_PROMPT_SNOOZE_MS } = await import('./prefs');
    const at = 1_800_000_000_000;
    snoozePushPrompt(at);
    expect(window.localStorage.getItem('haide.pushPrompt')).toBe(String(at));
    expect(pushPromptSnoozed(at + PUSH_PROMPT_SNOOZE_MS - 1)).toBe(true);
    expect(pushPromptSnoozed(at + PUSH_PROMPT_SNOOZE_MS)).toBe(false);
    window.localStorage.removeItem('haide.pushPrompt');
  });
});
