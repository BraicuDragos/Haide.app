import type { ErrorCode } from '../contracts/errors.ts';

/** Business rule violation. The API maps it one-to-one to an AppError. */
export class DomainError extends Error {
  readonly code: ErrorCode;
  readonly fields: Record<string, string> | undefined;

  constructor(code: ErrorCode, message?: string, fields?: Record<string, string>) {
    super(message ?? code);
    this.name = 'DomainError';
    this.code = code;
    this.fields = fields;
  }
}
