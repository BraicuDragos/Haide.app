import type { DataExportRequestResponse } from '@contracts/privacy';
import { apiRequest } from './client';

/** Privacy endpoints (e6 spec section 6). Types come from the shared contract. */
export type { DataExportRequestResponse };

/** DELETE /me. Idempotent: a second call answers 204 too. Anything but the literal word is a 400. */
export const deleteAccount = () =>
  apiRequest<void>('/me', { method: 'DELETE', body: { confirm: 'DELETE' }, timeoutMs: 30_000 });

/** POST /me/data-export-request. An open request from the last 30 days answers 202 with that request again. */
export const requestDataExport = () =>
  apiRequest<DataExportRequestResponse>('/me/data-export-request', { method: 'POST', body: {} });
