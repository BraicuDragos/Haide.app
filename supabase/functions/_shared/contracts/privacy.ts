import { z } from 'zod';

/**
 * Privacy contracts (E6): DELETE /me and POST /me/data-export-request. Shared with the web app
 * (import through @contracts). STABLE: additive changes only.
 */

/** The literal the client must send, so a stray DELETE cannot erase an account. */
export const DELETE_CONFIRMATION = 'DELETE';

// ---- DELETE /me (204, idempotent) -----------------------------------------------------------------------
// Anything else (missing, wrong literal) is answered with 400 CONFIRMATION_REQUIRED by the route.
export const deleteAccountBodySchema = z.object({ confirm: z.literal(DELETE_CONFIRMATION) });
export type DeleteAccountBody = z.infer<typeof deleteAccountBodySchema>;

// ---- POST /me/data-export-request (202) -----------------------------------------------------------------
export const dataExportRequestBodySchema = z.object({}).strict();
export type DataExportRequestBody = z.infer<typeof dataExportRequestBodySchema>;

export const dataExportRequestResponseSchema = z.object({
  requestId: z.uuid(),
  requestedAt: z.string(),
  /** requestedAt + 30 days: when the owner must have answered (GDPR Art. 12(3)). */
  dueBy: z.string(),
});
export type DataExportRequestResponse = z.infer<typeof dataExportRequestResponseSchema>;
