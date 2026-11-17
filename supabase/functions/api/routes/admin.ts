import { Hono } from 'hono';
import {
  adminErrorsQuerySchema,
  adminMetricsQuerySchema,
  adminNoteBodySchema,
  adminReportsQuerySchema,
  adminUsersQuerySchema,
  createEnergyPriceBodySchema,
  suspendBodySchema,
} from '../../_shared/contracts/admin.ts';
import { RATE_LIMITS } from '../../_shared/domain/rules.ts';
import { requireAdmin } from '../middleware/gates.ts';
import { rateLimit } from '../middleware/rateLimit.ts';
import {
  dismissReport,
  getOps,
  listErrors,
  listReports,
  listSuspended,
  suspendUser,
  unsuspendUser,
} from '../services/admin.ts';
import { createEnergyPrice, listEnergyPrices } from '../services/energyPrices.ts';
import { getMetrics } from '../services/metrics.ts';
import type { AppBindings } from '../types.ts';
import { parse, readJson, readOptionalJson } from '../validate.ts';

/**
 * Admin area (E7, ADR 0033, e7-metrics-admin-spec §6). Every route needs an active account with role
 * `admin` (re-read per request: anonymous 401, a plain user 403 FORBIDDEN, a suspended admin 403
 * ACCOUNT_SUSPENDED) and shares one rate limit. Handlers only parse, call a service and shape the
 * response; every write is audited in `admin_actions` by its service.
 */
export const adminRoutes = new Hono<AppBindings>();

adminRoutes.use('/admin/*', requireAdmin, rateLimit('admin', RATE_LIMITS.admin));

// GET /admin/metrics?week=2026-W47
adminRoutes.get('/admin/metrics', async (c) => {
  const q = parse(adminMetricsQuerySchema, c.req.query());
  return c.json(await getMetrics(c.get('deps'), q.week));
});

// GET /admin/reports?status=&limit=&cursor=
adminRoutes.get('/admin/reports', async (c) => {
  const q = parse(adminReportsQuerySchema, c.req.query());
  return c.json(await listReports(c.get('deps'), q));
});

// POST /admin/reports/{id}/dismiss { note? } -> 204
adminRoutes.post('/admin/reports/:id/dismiss', async (c) => {
  const body = parse(adminNoteBodySchema, await readOptionalJson(c));
  await dismissReport(c.get('deps'), c.get('account'), c.req.param('id'), body);
  return c.body(null, 204);
});

// POST /admin/users/{id}/suspend { reasonCode, statement, reportId? } -> 204
adminRoutes.post('/admin/users/:id/suspend', async (c) => {
  const body = parse(suspendBodySchema, await readJson(c));
  await suspendUser(c.get('deps'), c.get('account'), c.req.param('id'), body);
  return c.body(null, 204);
});

// POST /admin/users/{id}/unsuspend { note? } -> 204
adminRoutes.post('/admin/users/:id/unsuspend', async (c) => {
  const body = parse(adminNoteBodySchema, await readOptionalJson(c));
  await unsuspendUser(c.get('deps'), c.get('account'), c.req.param('id'), body);
  return c.body(null, 204);
});

// GET /admin/users?status=suspended
adminRoutes.get('/admin/users', async (c) => {
  parse(adminUsersQuerySchema, c.req.query());
  return c.json(await listSuspended(c.get('deps')));
});

// GET /admin/energy-prices
adminRoutes.get('/admin/energy-prices', async (c) => c.json(await listEnergyPrices(c.get('deps'))));

// POST /admin/energy-prices -> 201 { item }
adminRoutes.post('/admin/energy-prices', async (c) => {
  const body = parse(createEnergyPriceBodySchema, await readJson(c));
  return c.json(await createEnergyPrice(c.get('deps'), c.get('account'), body), 201);
});

// GET /admin/ops
adminRoutes.get('/admin/ops', async (c) => c.json(await getOps(c.get('deps'))));

// GET /admin/errors?limit=50
adminRoutes.get('/admin/errors', async (c) => {
  const q = parse(adminErrorsQuerySchema, c.req.query());
  return c.json(await listErrors(c.get('deps'), q.limit));
});
