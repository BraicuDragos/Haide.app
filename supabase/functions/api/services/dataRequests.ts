import type { DataExportRequestResponse } from '../../_shared/contracts/privacy.ts';
import { DATA_REQUEST_DUE_DAYS } from '../../_shared/domain/rules.ts';
import {
  dataExportAckOutbox,
  dataExportRequestedOutbox,
  dataRequestDueBy,
} from '../../_shared/domain/privacy.ts';
import { insertOutboxRows } from '../repo/outbox.ts';
import { findOpenDataRequest, insertDataRequest, lockProfile } from '../repo/privacy.ts';
import type { Account, Deps } from '../types.ts';
import { tx } from './bookings.ts';

const DAY_MS = 86_400_000;

const toResponse = (id: string, requestedAt: Date | string): DataExportRequestResponse => {
  const at = new Date(requestedAt);
  return {
    requestId: id,
    requestedAt: at.toISOString(),
    dueBy: dataRequestDueBy(at).toISOString(),
  };
};

/**
 * POST /me/data-export-request (E6-4, ADR 0031). Records the request and queues two emails: one to the
 * support address (the dispatcher routes `data_export_requested`) and an acknowledgement to the user.
 * An unfulfilled request from the last 30 days is returned as it is, with no new row and no new mail.
 * The profile row lock makes two parallel taps create one request. The export itself is
 * app.export_user_data, run by the owner (never reachable through the API).
 */
export async function requestDataExport(
  deps: Deps,
  account: Account,
): Promise<DataExportRequestResponse> {
  const now = deps.clock.now();
  const since = new Date(now.getTime() - DATA_REQUEST_DUE_DAYS * DAY_MS);

  return await tx(deps, async (db) => {
    await lockProfile(db, account.id);
    const open = await findOpenDataRequest(db, account.id, since);
    if (open) return toResponse(open.id, open.requested_at);

    const created = await insertDataRequest(db, account.id, now);
    const response = toResponse(created.id, created.requested_at);
    await insertOutboxRows(db, [
      dataExportRequestedOutbox(account.id, {
        requestId: created.id,
        userId: account.id,
        requestedAt: response.requestedAt,
      }),
      dataExportAckOutbox(account.id, { requestId: created.id, dueBy: response.dueBy }),
    ]);
    return response;
  });
}
