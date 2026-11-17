import en from './en.json';
// Messages that live next to a lazy feature (type-only import: no bytes in the entry chunk). The feature registers them
// at runtime with registerMessages() when its chunk loads.
import type admin from '@/features/admin/admin.en.json';

/**
 * Minimal i18n: flat dotted keys, `{param}` interpolation, `key.one` / `key.other` plurals via Intl.PluralRules.
 * Params are plain strings; React escapes them on render, so never feed the result to dangerouslySetInnerHTML.
 * Add a language by adding `<lang>.json` and switching `messages`. Romanian will need `few`: the suffix mechanism
 * below already looks up `key.<category>` before falling back to `key.other`.
 */
export type MessageKey = keyof typeof en | keyof typeof admin;
type Params = Record<string, string | number>;

const messages: Record<string, string> = { ...en };

/** Adds the messages of a lazy-loaded feature. Call at module top level of the feature's entry chunk. */
export function registerMessages(extra: Record<string, string>): void {
  Object.assign(messages, extra);
}
const locale = 'en';
const plural = new Intl.PluralRules(locale);

function fill(template: string, params?: Params): string {
  if (!params) return template;
  return template.replace(/\{(\w+)\}/g, (m, k: string) => (k in params ? String(params[k]) : m));
}

export function t(key: MessageKey, params?: Params): string {
  return fill(messages[key] ?? key, params);
}

/** Plural lookup: `tp('place.count', 3)` -> `place.count.other` with {n}. */
export function tp(base: string, n: number, params?: Params): string {
  const cat = plural.select(n);
  const template = messages[`${base}.${cat}`] ?? messages[`${base}.other`] ?? base;
  return fill(template, { n, ...params });
}

/** Looks up `errors.<CODE>` with a generic fallback (conventions §4). */
export function tError(code: string | undefined): string {
  return messages[`errors.${code ?? ''}`] ?? messages['errors.generic'] ?? '';
}

export const htmlLang = locale;
