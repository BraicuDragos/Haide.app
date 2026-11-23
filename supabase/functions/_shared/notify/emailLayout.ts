/**
 * Shared HTML layout for every transactional email (improvements item 6). Pure: strings in, string out.
 * Table-based, all styles inline, 600px max and fluid below. The only <style> block carries the
 * mobile and dark-mode media queries, so a client that strips it still shows a readable light email.
 * No images, no tracking pixels, no remote resources: the wordmark is text in the brand colours.
 * Colours come from docs/brand/design-tokens.json (theme.light and theme.dark).
 */

export const escapeHtml = (s: string): string =>
  s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');

/** Brand colours used by the email (tokens: theme.light / theme.dark). */
export const EMAIL_COLORS = {
  light: {
    page: '#F7F7FB',
    card: '#FFFFFF',
    text: '#1B1A2E',
    muted: '#55556F',
    border: '#E0E0EC',
    action: '#5043C6',
    onAction: '#FFFFFF',
    link: '#4639B0',
    accent: '#FFC21A',
  },
  dark: {
    page: '#12112A',
    card: '#1C1B3D',
    text: '#F2F1FB',
    muted: '#B4B3D0',
    border: '#34336A',
    action: '#FFC21A',
    onAction: '#1B1A2E',
    link: '#A9A2E8',
    accent: '#FFC21A',
  },
} as const;

const FONT_BODY =
  "Figtree, system-ui, -apple-system, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif";
const FONT_HEADING =
  "Sora, Figtree, system-ui, -apple-system, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif";

export type LayoutInput = {
  lang?: string;
  title: string;
  /** Body text; newlines become line breaks. */
  body: string;
  /** Hidden inbox preview text. */
  preheader: string;
  /** Button; null for mails where an app link makes no sense. */
  cta: { href: string; label: string } | null;
  /** Plain-text link line shown under the button, already worded. */
  linkLine: string | null;
  footer: { support: string; why: string; controller: string };
  wordmark: string;
};

const C = EMAIL_COLORS;

const button = (href: string, label: string): string => {
  const h = escapeHtml(href);
  const l = escapeHtml(label);
  return (
    // Outlook (Word engine) ignores padding on <a>: it gets a VML rounded rectangle instead.
    `<!--[if mso]><v:roundrect xmlns:v="urn:schemas-microsoft-com:vml" xmlns:w="urn:schemas-microsoft-com:office:word" href="${h}" style="height:48px;v-text-anchor:middle;width:220px;" arcsize="17%" stroke="f" fillcolor="${C.light.action}"><w:anchorlock/><center style="color:${C.light.onAction};font-family:Arial,sans-serif;font-size:16px;font-weight:bold;">${l}</center></v:roundrect><![endif]-->` +
    `<!--[if !mso]><!-->` +
    `<table role="presentation" cellpadding="0" cellspacing="0" border="0" class="btn-wrap"><tr>` +
    `<td align="center" bgcolor="${C.light.action}" class="btn-td" style="background-color:${C.light.action};border-radius:8px;">` +
    `<a href="${h}" class="btn-a" style="display:inline-block;min-height:20px;padding:14px 32px;font-family:${FONT_BODY};font-size:16px;line-height:20px;font-weight:700;color:${C.light.onAction};background-color:${C.light.action};text-decoration:none;border-radius:8px;">${l}</a>` +
    `</td></tr></table>` +
    `<!--<![endif]-->`
  );
};

export function renderLayout(i: LayoutInput): string {
  const bodyHtml = escapeHtml(i.body).replace(/\n/g, '<br>');
  const css =
    `:root{color-scheme:light dark;supported-color-schemes:light dark;}` +
    `@media only screen and (max-width:620px){` +
    `.container{width:100%!important;}.pad{padding:20px 16px!important;}` +
    `.h1{font-size:22px!important;line-height:28px!important;}` +
    `.btn-wrap,.btn-td{width:100%!important;}.btn-a{display:block!important;}}` +
    `@media (prefers-color-scheme:dark){` +
    `.bg-page{background-color:${C.dark.page}!important;}` +
    `.bg-card{background-color:${C.dark.card}!important;}` +
    `.t-main{color:${C.dark.text}!important;}.t-muted{color:${C.dark.muted}!important;}` +
    `.t-link{color:${C.dark.link}!important;}` +
    `.b-line{border-color:${C.dark.border}!important;}` +
    `.btn-td{background-color:${C.dark.action}!important;}` +
    `.btn-a{background-color:${C.dark.action}!important;color:${C.dark.onAction}!important;}}`;

  const para = (color: string, text: string, size = 14): string =>
    `<p class="t-muted" style="margin:0 0 8px 0;font-family:${FONT_BODY};font-size:${size}px;line-height:1.5;color:${color};">${escapeHtml(text)}</p>`;

  const ctaBlock = i.cta
    ? `<tr><td style="padding:0 0 16px 0;">${button(i.cta.href, i.cta.label)}</td></tr>` +
      (i.linkLine
        ? `<tr><td style="padding:0 0 8px 0;"><p class="t-muted" style="margin:0;font-family:${FONT_BODY};font-size:14px;line-height:1.5;color:${C.light.muted};word-break:break-all;">${escapeHtml(i.linkLine)}</p></td></tr>`
        : '')
    : '';

  return (
    `<!doctype html>` +
    `<html lang="${escapeHtml(i.lang ?? 'en')}" xmlns:v="urn:schemas-microsoft-com:vml" xmlns:o="urn:schemas-microsoft-com:office:office">` +
    `<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">` +
    `<meta name="color-scheme" content="light dark"><meta name="supported-color-schemes" content="light dark">` +
    `<meta name="x-apple-disable-message-reformatting">` +
    `<title>${escapeHtml(i.title)}</title><style>${css}</style></head>` +
    `<body class="bg-page" bgcolor="${C.light.page}" style="margin:0;padding:0;background-color:${C.light.page};">` +
    `<div style="display:none;max-height:0;overflow:hidden;opacity:0;mso-hide:all;font-size:1px;line-height:1px;color:${C.light.page};">${escapeHtml(i.preheader)}${'&nbsp;&zwnj;'.repeat(20)}</div>` +
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" class="bg-page" bgcolor="${C.light.page}" style="background-color:${C.light.page};"><tr><td align="center" style="padding:24px 12px;">` +
    `<!--[if mso]><table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0"><tr><td><![endif]-->` +
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" class="container" style="width:100%;max-width:600px;">` +
    `<tr><td class="t-link" style="padding:0 0 16px 4px;font-family:${FONT_HEADING};font-size:28px;line-height:32px;font-weight:700;letter-spacing:-0.5px;color:${C.light.action};">` +
    `${escapeHtml(i.wordmark)}<span style="color:${C.light.accent};">.</span></td></tr>` +
    `<tr><td class="bg-card pad" bgcolor="${C.light.card}" style="padding:32px 28px;background-color:${C.light.card};border:1px solid ${C.light.border};border-radius:12px;">` +
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">` +
    `<tr><td style="padding:0 0 16px 0;"><h1 class="h1 t-main" style="margin:0;font-family:${FONT_HEADING};font-size:24px;line-height:30px;font-weight:700;color:${C.light.text};">${escapeHtml(i.title)}</h1></td></tr>` +
    `<tr><td style="padding:0 0 24px 0;"><p class="t-main" style="margin:0;font-family:${FONT_BODY};font-size:16px;line-height:1.5;color:${C.light.text};">${bodyHtml}</p></td></tr>` +
    ctaBlock +
    `</table></td></tr>` +
    `<tr><td style="padding:20px 4px 0 4px;">` +
    para(C.light.muted, i.footer.why) +
    para(C.light.muted, i.footer.support) +
    para(C.light.muted, i.footer.controller, 12) +
    `</td></tr></table>` +
    `<!--[if mso]></td></tr></table><![endif]-->` +
    `</td></tr></table></body></html>`
  );
}
