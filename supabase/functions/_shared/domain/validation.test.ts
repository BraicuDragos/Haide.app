import { describe, expect, it } from 'vitest';
import { DomainError } from './errors.ts';
import {
  normalizeBio,
  normalizeFirstName,
  normalizePhone,
  normalizePlate,
  normalizeVehicleText,
} from './validation.ts';

const fieldsOf = (fn: () => unknown) => {
  try {
    fn();
  } catch (e) {
    expect(e).toBeInstanceOf(DomainError);
    expect((e as DomainError).code).toBe('VALIDATION_FAILED');
    return (e as DomainError).fields;
  }
  throw new Error('expected a DomainError');
};

describe('normalizeFirstName', () => {
  it.each([
    'Ștefan',
    'Țepeș',
    'Ioana',
    'Ana-Maria',
    "O'Neil",
    'D’Arcy', // typographic apostrophe, as phone keyboards type it
    'Mihai Ion',
    'Ünal',
    'Ă',
  ])('accepts %s', (name) => expect(normalizeFirstName(name)).toBe(name));

  it('trims, collapses spaces and composes diacritics (NFC)', () => {
    expect(normalizeFirstName('  Ana   Maria ')).toBe('Ana Maria');
    expect(normalizeFirstName('Ștefan')).toBe('Ștefan'); // S + combining comma below
  });

  it('accepts exactly 30 characters, rejects 31', () => {
    expect(normalizeFirstName('ă'.repeat(30))).toHaveLength(30);
    expect(fieldsOf(() => normalizeFirstName('a'.repeat(31)))).toEqual({ firstName: 'too_long' });
  });

  it.each(['', '   ', '1Ana', 'Ana2', 'Ana_', '-Ana', 'Ana<script>', 'A.na', '😀'])(
    'rejects %j',
    (name) => expect(fieldsOf(() => normalizeFirstName(name))).toHaveProperty('firstName'),
  );
});

describe('normalizePhone', () => {
  it.each([
    ['0721 234 567', '+40721234567'],
    ['0721-234-567', '+40721234567'],
    ['0721.234.567', '+40721234567'],
    ['(0721) 234 567', '+40721234567'],
    ['+40 721 234 567', '+40721234567'],
    ['+40721234567', '+40721234567'],
    ['0040721234567', '+40721234567'],
    ['0799999999', '+40799999999'],
  ])('normalises %s', (input, expected) => expect(normalizePhone(input)).toBe(expected));

  it.each([
    ['0269 123 456', 'not_romanian_mobile'], // Sibiu landline
    ['+40269123456', 'not_romanian_mobile'],
    ['+4915112345678', 'not_romanian'], // German
    ['+390212345678', 'not_romanian'],
    ['721234567', 'not_romanian'], // no prefix
    ['072123456', 'not_romanian_mobile'], // too short
    ['07212345678', 'not_romanian_mobile'], // too long
    ['abc', 'invalid_characters'],
    ['', 'invalid_characters'],
    ['0721 234 56x', 'invalid_characters'],
  ])('rejects %s', (input, reason) =>
    expect(fieldsOf(() => normalizePhone(input))).toEqual({ phone: reason }),
  );
});

describe('normalizePlate', () => {
  it.each([
    ['sb 12 abc', 'SB12ABC'],
    ['SB-12-ABC', 'SB12ABC'],
    ['b 123 xyz', 'B123XYZ'],
    ['  Sb.99.Zzz ', 'SB99ZZZ'],
  ])('normalises %s', (input, expected) => expect(normalizePlate(input)).toBe(expected));

  it.each(['', 'ab', 'a b c', 'SB 12 ĂBC', 'SB12ABC12345', 'SB#12ABC'])('rejects %j', (input) =>
    expect(fieldsOf(() => normalizePlate(input))).toEqual({ plate: 'invalid' }),
  );
});

describe('normalizeBio', () => {
  it('keeps text, trims and maps empty to null', () => {
    expect(normalizeBio('  Merg zilnic spre Șelimbăr  ')).toBe('Merg zilnic spre Șelimbăr');
    expect(normalizeBio('   ')).toBeNull();
    expect(normalizeBio(null)).toBeNull();
  });

  it('allows 200 code points and rejects 201 (emoji count once)', () => {
    expect(normalizeBio('ț'.repeat(200))).toHaveLength(200);
    expect(normalizeBio('😀'.repeat(200))).not.toBeNull();
    expect(fieldsOf(() => normalizeBio('a'.repeat(201)))).toEqual({ bio: 'too_long' });
  });
});

describe('normalizeVehicleText', () => {
  it('accepts 1-30 chars and collapses whitespace', () => {
    expect(normalizeVehicleText('make', ' Dacia ')).toBe('Dacia');
    expect(normalizeVehicleText('colour', 'Gri  închis')).toBe('Gri închis');
    expect(normalizeVehicleText('model', 'x'.repeat(30))).toHaveLength(30);
  });

  it('names the failing field', () => {
    expect(fieldsOf(() => normalizeVehicleText('model', ' '))).toEqual({ model: 'required' });
    expect(fieldsOf(() => normalizeVehicleText('make', 'x'.repeat(31)))).toEqual({
      make: 'too_long',
    });
  });
});
