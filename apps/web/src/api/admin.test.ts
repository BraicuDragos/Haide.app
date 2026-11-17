import { afterEach, describe, expect, it, vi } from 'vitest';
import { dismissReport, getAdminMetrics, postEnergyPrice, suspendUser } from './admin';

afterEach(() => vi.restoreAllMocks());

const call = (spy: ReturnType<typeof vi.spyOn>) => spy.mock.calls[0] as [URL, RequestInit];

describe('admin API', () => {
  it('GET /admin/metrics sends the week as a query parameter', async () => {
    const spy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(Response.json({ week: '2026-W47' }));
    await getAdminMetrics('2026-W47');
    const [url, init] = call(spy);
    expect(url.pathname.endsWith('/admin/metrics')).toBe(true);
    expect(url.searchParams.get('week')).toBe('2026-W47');
    expect(init.method).toBe('GET');
  });

  it('POST suspend sends the code, the statement and the report id, and the id is path-encoded', async () => {
    const spy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response(null, { status: 204 }));
    await suspendUser('u/1', {
      reasonCode: 'harassment',
      statement: 'Repeated reports.',
      reportId: 'r-1',
    });
    const [url, init] = call(spy);
    expect(url.pathname.endsWith('/admin/users/u%2F1/suspend')).toBe(true);
    expect(JSON.parse(init.body as string)).toEqual({
      reasonCode: 'harassment',
      statement: 'Repeated reports.',
      reportId: 'r-1',
    });
  });

  it('dismiss sends an empty body without a note and the note when given', async () => {
    const spy = vi
      .spyOn(globalThis, 'fetch')
      .mockImplementation(() => Promise.resolve(new Response(null, { status: 204 })));
    await dismissReport('r-1');
    await dismissReport('r-1', 'Not a ToS issue');
    const bodies = spy.mock.calls.map((c) => JSON.parse((c[1] as RequestInit).body as string));
    expect(bodies).toEqual([{}, { note: 'Not a ToS issue' }]);
  });

  it('a large change answers 409 LARGE_CHANGE with the field', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      Response.json(
        {
          error: {
            code: 'LARGE_CHANGE',
            message: 'x',
            requestId: 'r',
            fields: { priceMilli: 'large_change' },
          },
        },
        { status: 409 },
      ),
    );
    await expect(
      postEnergyPrice({
        fuelType: 'petrol',
        priceMilli: 9000,
        consumptionCenti: 650,
        sourceNote: 'x',
      }),
    ).rejects.toMatchObject({
      code: 'LARGE_CHANGE',
      status: 409,
      fields: { priceMilli: 'large_change' },
    });
  });
});
