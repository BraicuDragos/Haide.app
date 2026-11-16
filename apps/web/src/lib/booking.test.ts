import { describe, expect, it } from 'vitest';
import { expectedExpiry, isExactPoint, telHref, whatsappHref } from './booking';

describe('booking helpers', () => {
  it('tells exact points from approximate ones by the approx flag', () => {
    expect(isExactPoint({ lat: 45.74132, lng: 24.18611 })).toBe(true);
    expect(isExactPoint({ lat: 45.741, lng: 24.186, approx: true, radiusM: 300 })).toBe(false);
  });

  it('builds tel and WhatsApp links from E.164 digits only', () => {
    expect(telHref('+40721234567')).toBe('tel:+40721234567');
    expect(whatsappHref('+40721234567')).toBe('https://wa.me/40721234567');
    expect(whatsappHref('+40 721 <b>234</b> 567')).toBe('https://wa.me/40721234567');
  });

  it('expires 30 minutes after now, or 10 minutes before departure when that is sooner', () => {
    const now = Date.parse('2026-11-16T05:00:00Z');
    expect(expectedExpiry('2026-11-16T08:00:00Z', now)).toBe('2026-11-16T05:30:00.000Z');
    expect(expectedExpiry('2026-11-16T05:25:00Z', now)).toBe('2026-11-16T05:15:00.000Z');
  });
});
