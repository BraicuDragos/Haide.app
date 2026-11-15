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

/** Renders the error envelope (api-contract §1.1). Unknown errors become 500 INTERNAL, no details. */
export const onError: ErrorHandler<AppBindings> = async (err, c) => {
  const reqId = c.get('reqId') ?? 'unknown';
  const deps = c.get('deps');

  if (err instanceof DomainError || err instanceof AppError) {
    const app = err instanceof DomainError ? AppError.from(err) : err;
    for (const [k, v] of Object.entries(app.headers ?? {})) c.header(k, v);
    return c.json(envelope(app.code, app.message, reqId, app.fields), app.status);
  }

  // Unexpected: log the class name only (messages may contain SQL text or user data).
  deps.log('error', 'unhandled_error', { reqId, route: c.req.routePath, name: err.name });
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
