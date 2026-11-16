import type { Context } from 'hono';
import type { z } from 'zod';
import { AppError } from '../_shared/errors.ts';

/** zod safeParse at the route boundary. Failures become 400 VALIDATION_FAILED with `fields`. */
export function parse<T extends z.ZodType>(schema: T, input: unknown): z.infer<T> {
  const result = schema.safeParse(input);
  if (result.success) return result.data;
  const fields: Record<string, string> = {};
  for (const issue of result.error.issues) {
    const key = issue.path.map(String).join('.') || '_';
    fields[key] ??= issue.code;
  }
  throw new AppError('VALIDATION_FAILED', 'Request validation failed.', { fields });
}

/** Like readJson, but an empty body counts as `{}` (POST endpoints whose body is optional). */
export async function readOptionalJson(c: Context): Promise<unknown> {
  const text = await c.req.text();
  if (text.trim() === '') return {};
  try {
    return JSON.parse(text);
  } catch {
    throw new AppError('VALIDATION_FAILED', 'Body must be valid JSON.', {
      fields: { _: 'invalid_json' },
    });
  }
}

/** Parse a JSON body. Malformed JSON is a validation error, never a 500. */
export async function readJson(c: Context): Promise<unknown> {
  try {
    return await c.req.json();
  } catch {
    throw new AppError('VALIDATION_FAILED', 'Body must be valid JSON.', {
      fields: { _: 'invalid_json' },
    });
  }
}
