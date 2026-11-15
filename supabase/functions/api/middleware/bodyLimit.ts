import { bodyLimit } from 'hono/body-limit';
import type { MiddlewareHandler } from 'hono';
import { AppError } from '../../_shared/errors.ts';
import { BODY_LIMIT_DEFAULT_BYTES, BODY_LIMIT_PHOTO_BYTES } from '../../_shared/domain/rules.ts';
import type { AppBindings } from '../types.ts';

/**
 * Caps request bodies: 64 KB everywhere, about 1.6 MB on the photo upload (1.5 MB file plus
 * multipart overhead). Enforced on Content-Length when present and while streaming otherwise.
 */
export const requestBodyLimit: MiddlewareHandler<AppBindings> = (c, next) => {
  const photo = c.req.path.endsWith('/me/photo');
  return bodyLimit({
    maxSize: photo ? BODY_LIMIT_PHOTO_BYTES : BODY_LIMIT_DEFAULT_BYTES,
    onError: () => {
      throw photo
        ? new AppError('PHOTO_TOO_LARGE', 'Photo is larger than 1.5 MB.')
        : new AppError('VALIDATION_FAILED', 'Request body is too large.', {
            fields: { _: 'body_too_large' },
          });
    },
  })(c, next);
};
