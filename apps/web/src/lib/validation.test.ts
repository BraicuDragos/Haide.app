import { describe, expect, it } from 'vitest';
import { fitWithin } from './image';
import { isValidFirstName, isValidPlate, normalizePlate, normalizeRoPhone } from './validation';

describe('first name', () => {
  it.each(['Ioana', 'Ștefan', 'Țepeș', 'Ana-Maria', "D'Arcy", 'Ion Mihai'])('accepts %s', (n) =>
    expect(isValidFirstName(n)).toBe(true),
  );
  it.each(['', '   ', 'A1', 'x'.repeat(31), '-Ana', 'Ana--Maria', '<b>'])('rejects %j', (n) =>
    expect(isValidFirstName(n)).toBe(false),
  );
});

describe('Romanian mobile', () => {
  it.each([
    ['0721 234 567', '+40721234567'],
    ['+40 721 234 567', '+40721234567'],
    ['0040721234567', '+40721234567'],
    ['0721-234-567', '+40721234567'],
  ])('normalises %s', (raw, out) => expect(normalizeRoPhone(raw)).toBe(out));
  it.each(['0269 123 456', '+44 7911 123456', '0721 234', 'abc', ''])('rejects %j', (raw) =>
    expect(normalizeRoPhone(raw)).toBeNull(),
  );
});

describe('plate', () => {
  it('normalises case and spaces', () => expect(normalizePlate('sb 38 and')).toBe('SB38AND'));
  it.each(['SB 38 AND', 'b 123 abc', 'CJ12XYZ'])('accepts %s', (p) =>
    expect(isValidPlate(p)).toBe(true),
  );
  it.each(['', 'SB', '1234567', 'SB 38'])('rejects %j', (p) => expect(isValidPlate(p)).toBe(false));
});

describe('fitWithin', () => {
  it('never scales up', () => expect(fitWithin(800, 600)).toEqual({ w: 800, h: 600 }));
  it('shrinks the long side to 1024', () => {
    expect(fitWithin(4000, 3000)).toEqual({ w: 1024, h: 768 });
    expect(fitWithin(3000, 4000)).toEqual({ w: 768, h: 1024 });
  });
});
