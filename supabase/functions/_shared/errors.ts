import { ERROR_STATUS } from './contracts/errors.ts';
import type { ErrorCode } from './contracts/errors.ts';
import type { DomainError } from './domain/errors.ts';

/** HTTP-facing error. Services and domain guards throw it, middleware renders the envelope. */
export class AppError extends Error {
  readonly code: ErrorCode;
  readonly status: (typeof ERROR_STATUS)[ErrorCode];
  readonly fields: Record<string, string> | undefined;
  readonly headers: Record<string, string> | undefined;

  constructor(
    code: ErrorCode,
    message?: string,
    options?: { fields?: Record<string, string>; headers?: Record<string, string> },
  ) {
    super(message ?? code);
    this.name = 'AppError';
    this.code = code;
    this.status = ERROR_STATUS[code];
    this.fields = options?.fields;
    this.headers = options?.headers;
  }

  static from(e: DomainError): AppError {
    return new AppError(e.code, e.message, e.fields ? { fields: e.fields } : undefined);
  }
}
