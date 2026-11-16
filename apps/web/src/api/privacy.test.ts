import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ApiError } from './client';
import { deleteAccount, requestDataExport } from './privacy';

afterEach(() => vi.restoreAllMocks());

describe('privacy API', () => {
  it('DELETE /me sends the confirmation word and treats 204 as done', async () => {
    const spy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response(null, { status: 204 }));
    await expect(deleteAccount()).resolves.toBeUndefined();
    const [url, init] = spy.mock.calls[0] as [URL, RequestInit];
    expect(url.pathname.endsWith('/me')).toBe(true);
    expect(init.method).toBe('DELETE');
    expect(JSON.parse(init.body as string)).toEqual({ confirm: 'DELETE' });
  });

  it('surfaces the error code when deletion fails', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      Response.json(
        { error: { code: 'CONFIRMATION_REQUIRED', message: 'x', requestId: 'r' } },
        { status: 400 },
      ),
    );
    await expect(deleteAccount()).rejects.toMatchObject({
      code: 'CONFIRMATION_REQUIRED',
    } satisfies Partial<ApiError>);
  });

  it('POST /me/data-export-request returns the dates', async () => {
    const body = {
      requestId: 'q-1',
      requestedAt: '2026-11-21T10:00:00Z',
      dueBy: '2026-12-21T10:00:00Z',
    };
    const spy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(Response.json(body, { status: 202 }));
    await expect(requestDataExport()).resolves.toEqual(body);
    const [url, init] = spy.mock.calls[0] as [URL, RequestInit];
    expect(url.pathname.endsWith('/me/data-export-request')).toBe(true);
    expect(init.method).toBe('POST');
  });
});
