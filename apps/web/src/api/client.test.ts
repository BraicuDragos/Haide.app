import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiError, apiRequest, setTokenProvider } from './client';
import { tError, tp } from '@/i18n';

afterEach(() => {
  vi.restoreAllMocks();
  setTokenProvider(() => null);
});

function mockFetch(res: Response) {
  return vi.spyOn(globalThis, 'fetch').mockResolvedValue(res);
}

describe('apiRequest', () => {
  it('returns parsed JSON and sends the bearer token', async () => {
    setTokenProvider(() => 'jwt-123');
    const spy = mockFetch(Response.json({ items: [] }));
    await expect(apiRequest('/places', { query: { q: 'selimbar', limit: 8 } })).resolves.toEqual({
      items: [],
    });
    const [url, init] = spy.mock.calls[0] as [URL, RequestInit];
    expect(url.pathname.endsWith('/places')).toBe(true);
    expect(url.searchParams.get('q')).toBe('selimbar');
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer jwt-123');
  });

  it('maps the error envelope to ApiError', async () => {
    mockFetch(
      Response.json(
        {
          error: {
            code: 'RATE_LIMITED',
            message: 'slow down',
            requestId: 'r1',
            fields: { q: 'too_short' },
          },
        },
        { status: 429, headers: { 'Retry-After': '12' } },
      ),
    );
    const err = await apiRequest('/places').catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect(err).toMatchObject({
      code: 'RATE_LIMITED',
      status: 429,
      requestId: 'r1',
      retryAfterS: 12,
      fields: { q: 'too_short' },
    });
  });

  it('turns network failures into code NETWORK', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new TypeError('failed'));
    await expect(apiRequest('/health')).rejects.toMatchObject({ code: 'NETWORK', status: 0 });
  });

  it('handles 204', async () => {
    mockFetch(new Response(null, { status: 204 }));
    await expect(
      apiRequest('/telemetry/error', { method: 'POST', body: {} }),
    ).resolves.toBeUndefined();
  });
});

describe('i18n', () => {
  it('pluralises', () => {
    expect(tp('place.count', 1)).toBe('1 place found');
    expect(tp('place.count', 3)).toBe('3 places found');
  });
  it('falls back to the generic error text for unknown codes', () => {
    expect(tError('TEAPOT')).toBe(tError('SOMETHING_ELSE'));
    expect(tError('RATE_LIMITED')).toContain('Too many');
  });
});
