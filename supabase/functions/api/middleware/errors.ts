import type { ErrorHandler, NotFoundHandler } from 'hono';
import type { ErrorEnvelope } from '../../_shared/contracts/errors.ts';
import { DomainError } from '../../_shared/domain/errors.ts';
import { AppError } from '../../_shared/errors.ts';
import { scrubText } from '../../_shared/scrub.ts';
import { recordAppError } from '../repo/system.ts';
import type { AppBindings } from '../types.ts';

function envelope(
  code: AppError['code'],
  message: string,
  requestId: string,
  fields?: Record<string, string>,
) {
  const body: ErrorEnvelope = {
    error: { code, message, requestId, ...(fields ? { fields } : {}) },
  };
  return body;
}

const PG_TEXT_FIELDS = [
  ['code', 'pgCode'],
  ['constraint_name', 'pgConstraint'],
  ['table_name', 'pgTable'],
  ['column_name', 'pgColumn'],
  ['routine', 'pgRoutine'],
] as const;

/**
 * Safe diagnostics of a postgres.js PostgresError: SQLSTATE, constraint, table, column, routine and
 * the scrubbed server message. Never the `detail` / `where` / query text (they hold row values).
 */
export function pgDiagnostics(err: Error): Record<string, string> {
  if (err.name !== 'PostgresError') return {};
  const e = err as unknown as Record<string, unknown>;
  const out: Record<string, string> = {};
  for (const [field, key] of PG_TEXT_FIELDS) {
    const v = e[field];
    if (typeof v === 'string' && v !== '') out[key] = scrubText(v, 100);
  }
  if (err.message) out.pgMessage = scrubText(err.message, 200);
  return out;
}

/** Renders the error envelope (api-contract §1.1). Unknown errors become 500 INTERNAL, no details. */
export const onError: ErrorHandler<AppBindings> = async (err, c) => {
  const reqId = c.get('reqId') ?? 'unknown';
  const deps = c.get('deps');

  if (err instanceof DomainError || err instanceof AppError) {
    const app = err instanceof DomainError ? AppError.from(err) : err;
    for (const [k, v] of Object.entries(app.headers ?? {})) c.header(k, v);
    return c.json(envelope(app.code, app.message, reqId, app.fields), app.status);
  }

  // Unexpected: class name plus scrubbed Postgres diagnostics (no detail, no row values).
  deps.log('error', 'unhandled_error', {
    reqId,
    route: c.req.routePath,
    name: err.name,
    ...pgDiagnostics(err),
  });
  try {
    await recordAppError(deps.sql, {
      source: 'server',
      message: scrubText(`${err.name}: ${err.message}`, 500),
      stack: err.stack ? scrubText(err.stack, 4000) : null,
      route: c.req.routePath,
      appVersion: deps.env.APP_VERSION,
      userIdHash: null,
    });
  } catch {
    // never let error reporting fail the response
  }
  return c.json(envelope('INTERNAL', 'Something went wrong.', reqId), 500);
};

export const onNotFound: NotFoundHandler<AppBindings> = (c) =>
  c.json(envelope('NOT_FOUND', 'Not found.', c.get('reqId') ?? 'unknown'), 404);
