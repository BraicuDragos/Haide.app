import { FIRST_NAME_PATTERN } from '../contracts/account.ts';
import { DomainError } from './errors.ts';
import { BIO_MAX_CHARS, FIRST_NAME_MAX_CHARS, VEHICLE_TEXT_MAX_CHARS } from './rules.ts';

/** Pure input normalisation and validation for accounts (E1). Failures are VALIDATION_FAILED. */

const fail = (field: string, reason: string): never => {
  throw new DomainError('VALIDATION_FAILED', `Invalid ${field}.`, { [field]: reason });
};

const charCount = (s: string) => [...s].length; // code points, like Postgres char_length

/** Trim, NFC-normalise and collapse inner whitespace runs to one space. */
function clean(input: string): string {
  return input.normalize('NFC').replace(/\s+/g, ' ').trim();
}

/** First name: Unicode letters, space, hyphen, apostrophe; starts with a letter; 1-30 chars. */
export function normalizeFirstName(input: string): string {
  const name = clean(input);
  if (name.length === 0) return fail('firstName', 'required');
  if (charCount(name) > FIRST_NAME_MAX_CHARS) return fail('firstName', 'too_long');
  if (!FIRST_NAME_PATTERN.test(name)) return fail('firstName', 'invalid_characters');
  return name;
}

/**
 * Romanian mobile to E.164. Accepts `0721 234 567`, `0721-234-567`, `+40 721 234 567`,
 * `0040721234567`. Rejects landlines and foreign numbers: only `+407XXXXXXXX` passes.
 */
export function normalizePhone(input: string): string {
  const compact = input.normalize('NFKC').replace(/[\s().-]/g, '');
  if (!/^\+?\d+$/.test(compact)) return fail('phone', 'invalid_characters');
  let national: string;
  if (compact.startsWith('+40')) national = compact.slice(3);
  else if (compact.startsWith('0040')) national = compact.slice(4);
  else if (compact.startsWith('0') && !compact.startsWith('+')) national = compact.slice(1);
  else return fail('phone', 'not_romanian');
  if (!/^7\d{8}$/.test(national)) return fail('phone', 'not_romanian_mobile');
  return `+40${national}`;
}

/** Plate: uppercase, no spaces/dashes/dots; 4-10 of A-Z0-9 (`sb 12 abc` -> `SB12ABC`). */
export function normalizePlate(input: string): string {
  const plate = input
    .normalize('NFKC')
    .replace(/[\s.-]/g, '')
    .toUpperCase();
  if (!/^[A-Z0-9]{4,10}$/.test(plate)) return fail('plate', 'invalid');
  return plate;
}

/** Bio: optional, at most 200 characters. Empty becomes null. */
export function normalizeBio(input: string | null): string | null {
  if (input === null) return null;
  const bio = input.normalize('NFC').trim();
  if (bio.length === 0) return null;
  if (charCount(bio) > BIO_MAX_CHARS) return fail('bio', 'too_long');
  return bio;
}

/** Vehicle make, model or colour: 1-30 characters after trimming. */
export function normalizeVehicleText(field: string, input: string): string {
  const text = clean(input);
  if (text.length === 0) return fail(field, 'required');
  if (charCount(text) > VEHICLE_TEXT_MAX_CHARS) return fail(field, 'too_long');
  return text;
}
