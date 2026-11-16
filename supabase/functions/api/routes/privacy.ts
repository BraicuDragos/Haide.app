import { Hono } from 'hono';
import {
  dataExportRequestBodySchema,
  deleteAccountBodySchema,
} from '../../_shared/contracts/privacy.ts';
import { RATE_LIMITS } from '../../_shared/domain/rules.ts';
import { AppError } from '../../_shared/errors.ts';
import { requireAccount, requireNotDeleted } from '../middleware/gates.ts';
import { rateLimit } from '../middleware/rateLimit.ts';
import { deleteAccount } from '../services/accountDeletion.ts';
import { requestDataExport } from '../services/dataRequests.ts';
import type { AppBindings } from '../types.ts';
import { parse, readOptionalJson } from '../validate.ts';

/**
 * Privacy (E6): account deletion and "Request my data". Handlers only parse, run the gates, call a
 * service and shape the response. Deletion needs authentication and nothing else (a suspended user, or
 * one who has not accepted the new terms, may delete), and it is idempotent.
 */
export const privacyRoutes = new Hono<AppBindings>();

// DELETE /me: body { confirm: 'DELETE' }. 204, also when the account was already deleted.
privacyRoutes.delete(
  '/me',
  requireAccount,
  rateLimit('account', RATE_LIMITS.account),
  async (c) => {
    const parsed = deleteAccountBodySchema.safeParse(await readOptionalJson(c));
    if (!parsed.success) {
      throw new AppError('CONFIRMATION_REQUIRED', 'Confirm to delete your account.');
    }
    await deleteAccount(c.get('deps'), c.get('account'));
    return c.body(null, 204);
  },
);

// POST /me/data-export-request: 202 { requestId, requestedAt, dueBy }. 3 a day.
privacyRoutes.post(
  '/me/data-export-request',
  requireNotDeleted,
  rateLimit('data-request', RATE_LIMITS.dataRequest),
  async (c) => {
    parse(dataExportRequestBodySchema, await readOptionalJson(c));
    return c.json(await requestDataExport(c.get('deps'), c.get('account')), 202);
  },
);
