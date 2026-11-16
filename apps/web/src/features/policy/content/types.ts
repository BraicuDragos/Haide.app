/**
 * A published legal text. A published version never changes: any edit is a new version, a migration row in
 * `legal_documents` and a new content file (e6 spec section 4). The `.en.ts` suffix keeps it i18n-ready.
 */
export interface PolicyDoc {
  version: string;
  /** ISO date the version comes into force. */
  effectiveDate: string;
  /** Bullet list shown on the "updated terms" consent screen. */
  changes: string[];
  sections: { id: string; title: string; body: string[] }[];
}
