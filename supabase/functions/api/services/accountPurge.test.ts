import { afterEach, describe, expect, it, vi } from 'vitest';
import { fixedClock } from '../../_shared/domain/clock.ts';
import { silentLogger } from '../../_shared/log.ts';
import { PURGE_BATCH } from '../../_shared/domain/rules.ts';
import {
  fakeAuthAdmin,
  fakeSql,
  fakeStorage,
  testEnv,
  type Handler,
  type Query,
} from '../testing.ts';
import { createAuthAdmin } from './authAdmin.ts';
import { purgeAccount, runAccountPurges } from './accountPurge.ts';
import { AVATAR_CACHE_MAX_AGE_S, createAvatarStorage } from './storage.ts';

const USER = '3f0f4a2e-8d9c-4b1e-9a55-0c1d2e3f4a5b';
const PHOTO = 'avatars/6f1d8a5e-0000-4000-8000-000000000001.jpg';
const NOW = new Date('2026-11-16T05:00:00Z');

type Row = Partial<{
  photo_path: string | null;
  storage_done_at: Date | null;
  auth_done_at: Date | null;
  attempts: number;
}>;

function setup(row: Row | null, extra: Handler[] = []) {
  const open =
    row === null
      ? []
      : [
          {
            user_id: USER,
            requested_at: NOW,
            photo_path: PHOTO,
            storage_done_at: null,
            auth_done_at: null,
            attempts: 0,
            ...row,
          },
        ];
  const { sql, calls } = fakeSql([
    (q) => (q.text.startsWith('select user_id, requested_at, photo_path') ? open : undefined),
    (q) => (q.text.includes('set completed_at =') ? [{ user_id: USER }] : undefined),
    ...extra,
  ]);
  const store = fakeStorage();
  const auth = fakeAuthAdmin();
  const deps = {
    sql,
    storage: store.storage,
    authAdmin: auth.authAdmin,
    clock: fixedClock(NOW),
    log: silentLogger,
  };
  return { deps, calls, store, auth };
}

const find = (calls: Query[], fragment: string) => calls.find((c) => c.text.includes(fragment));

describe('purgeAccount', () => {
  it('removes the object and the auth user, marks both and completes the row', async () => {
    const { deps, calls, store, auth } = setup({});
    expect(await purgeAccount(deps, USER)).toBe(true);
    expect(store.removedStrict).toEqual([PHOTO]);
    expect(auth.deleted).toEqual([USER]);
    const storageDone = find(calls, 'set storage_done_at =') as Query;
    expect(storageDone.text).toContain('photo_path = null'); // no pointer to the photo stays
    expect(find(calls, 'set auth_done_at =')).toBeDefined();
    expect(find(calls, 'set completed_at =')).toBeDefined();
    expect(find(calls, 'set attempts =')).toBeUndefined();
  });

  it('skips Storage when the user had no photo', async () => {
    const { deps, store, auth } = setup({ photo_path: null });
    expect(await purgeAccount(deps, USER)).toBe(true);
    expect(store.removedStrict).toHaveLength(0);
    expect(auth.deleted).toEqual([USER]);
  });

  it('completes only when both sides are done: a failing auth call keeps the row open', async () => {
    const { deps, calls, store, auth } = setup({});
    auth.control.fail = true;
    expect(await purgeAccount(deps, USER)).toBe(false);
    expect(store.removedStrict).toEqual([PHOTO]); // storage succeeded and is recorded
    expect(find(calls, 'set storage_done_at =')).toBeDefined();
    expect(find(calls, 'set auth_done_at =')).toBeUndefined();
    expect(find(calls, 'set completed_at =')).toBeUndefined();
    const failure = find(calls, 'set attempts =') as Query;
    expect(failure.values[0]).toEqual(new Date('2026-11-16T05:01:00Z'));
    expect(String(failure.values[1])).toBe('auth: auth down');
  });

  it('does not repeat a side that already succeeded', async () => {
    const { deps, store, auth } = setup({ storage_done_at: NOW, photo_path: null });
    expect(await purgeAccount(deps, USER)).toBe(true);
    expect(store.removedStrict).toHaveLength(0);
    expect(auth.deleted).toEqual([USER]);

    const second = setup({ storage_done_at: NOW, auth_done_at: NOW, photo_path: null });
    expect(await purgeAccount(second.deps, USER)).toBe(true);
    expect(second.auth.deleted).toHaveLength(0);
  });

  it('does nothing for an unknown or already completed deletion', async () => {
    const { deps, store, auth } = setup(null);
    expect(await purgeAccount(deps, USER)).toBe(false);
    expect(store.removedStrict).toHaveLength(0);
    expect(auth.deleted).toHaveLength(0);
  });

  it.each([
    [0, 1],
    [1, 5],
    [2, 30],
    [3, 120],
    [4, 720],
    [5, 1440],
    [6, 1440],
    [40, 1440],
  ])('after %i earlier failures the next attempt is %i minutes away', async (attempts, minutes) => {
    const { deps, calls, store } = setup({ attempts });
    store.control.failStrict = true;
    await purgeAccount(deps, USER);
    const failure = find(calls, 'set attempts =') as Query;
    expect((failure.values[0] as Date).getTime() - NOW.getTime()).toBe(minutes * 60_000);
  });

  it('scrubs the recorded error: no email, phone or long text, at most 200 characters', async () => {
    const { deps, calls, store } = setup({});
    store.control.failStrict = true;
    // the fake throws a fixed message, so replace the storage with a hostile one
    deps.storage = {
      ...store.storage,
      removeStrict: () =>
        Promise.reject(new Error(`boom radu@example.com +40721234567 ${'x'.repeat(400)}`)),
    };
    await purgeAccount(deps, USER);
    const error = String((find(calls, 'set attempts =') as Query).values[1]);
    expect(error.length).toBeLessThanOrEqual(200);
    expect(error).not.toContain('radu@example.com');
    expect(error).not.toContain('721234567');
  });
});

describe('purgeAccount logging', () => {
  it('logs the failing step and a scrubbed reason, never the message text', async () => {
    const { deps } = setup({});
    const logged: { event: string; fields?: Record<string, unknown> }[] = [];
    deps.log = (_level, event, fields) => logged.push({ event, fields });
    deps.authAdmin = {
      deleteUser: () => Promise.reject(new Error('auth delete failed: 500 radu@example.com')),
    };
    await purgeAccount(deps, USER);
    deps.authAdmin = {
      deleteUser: () => Promise.reject(new Error('auth delete failed: 401')),
    };
    await purgeAccount(deps, USER);
    expect(logged[1]).toEqual({
      event: 'account_purge_step_failed',
      fields: { attempts: 1, steps: 'auth', reasons: 'http_401' },
    });
    // a message that does not end in a status falls back to the error class
    expect(logged[0]?.fields?.reasons).toBe('Error');
    expect(JSON.stringify(logged)).not.toContain('radu@example.com');
  });
});

describe('runAccountPurges', () => {
  it('takes the due rows, at most PURGE_BATCH, and counts the completed ones', async () => {
    const { deps, calls, auth } = setup({}, [
      (q) => (q.text.includes('next_attempt_at <=') ? [{ user_id: USER }] : undefined),
    ]);
    expect(await runAccountPurges(deps)).toBe(1);
    const due = find(calls, 'next_attempt_at <=') as Query;
    expect(due.text).toContain('completed_at is null');
    expect(due.values).toEqual([NOW, PURGE_BATCH]);
    expect(auth.deleted).toEqual([USER]);
  });

  it('one failing deletion does not stop the next', async () => {
    const OTHER = '9a1b2c3d-4e5f-4a6b-8c7d-0e1f2a3b4c5d';
    const { deps, auth } = setup({ photo_path: null }, [
      (q) =>
        q.text.includes('next_attempt_at <=') ? [{ user_id: USER }, { user_id: OTHER }] : undefined,
    ]);
    auth.control.fail = true;
    expect(await runAccountPurges(deps)).toBe(0);
    auth.control.fail = false;
    expect(await runAccountPurges(deps)).toBe(2);
  });
});

describe('removeStrict and deleteUser', () => {
  afterEach(() => vi.unstubAllGlobals());
  const env = testEnv({
    SUPABASE_URL: 'http://127.0.0.1:54321',
    SUPABASE_SERVICE_ROLE_KEY: 'service-role-key-for-tests-only',
  });
  const stub = (status: number) => {
    const fetchMock = vi.fn(() => Promise.resolve(new Response(null, { status })));
    vi.stubGlobal('fetch', fetchMock);
    return fetchMock;
  };

  it('Storage: 200 and 404 mean gone, any other status throws', async () => {
    const storage = createAvatarStorage(env);
    const ok = stub(200);
    await expect(storage.removeStrict(PHOTO)).resolves.toBeUndefined();
    expect(ok).toHaveBeenCalledWith(
      `http://127.0.0.1:54321/storage/v1/object/${PHOTO}`,
      expect.objectContaining({ method: 'DELETE' }),
    );
    stub(404);
    await expect(storage.removeStrict(PHOTO)).resolves.toBeUndefined();
    stub(500);
    await expect(storage.removeStrict(PHOTO)).rejects.toThrow('500');
    stub(403);
    await expect(storage.removeStrict(PHOTO)).rejects.toThrow('403');
  });

  it('Storage: refuses a path that is not an avatar and reports a missing configuration', async () => {
    await expect(createAvatarStorage(env).removeStrict('avatars/../x')).rejects.toThrow();
    await expect(createAvatarStorage(testEnv()).removeStrict(PHOTO)).rejects.toThrow('configured');
  });

  it('Storage: uploads are cached for 7 days, not a year', async () => {
    const fetchMock = stub(200);
    await createAvatarStorage(env).upload(PHOTO, new Uint8Array([1]));
    const init = (
      fetchMock.mock.calls[0] as unknown as [string, { headers: Record<string, string> }]
    )[1];
    expect(AVATAR_CACHE_MAX_AGE_S).toBe(604_800);
    expect(init.headers['cache-control']).toBe('max-age=604800');
  });

  it('Auth admin: DELETE /auth/v1/admin/users/{id} with the secret key, 404 means gone', async () => {
    const admin = createAuthAdmin(env);
    const ok = stub(200);
    await expect(admin.deleteUser(USER)).resolves.toBeUndefined();
    const [url, init] = ok.mock.calls[0] as unknown as [
      string,
      { method: string; headers: Record<string, string> },
    ];
    expect(url).toBe(`http://127.0.0.1:54321/auth/v1/admin/users/${USER}`);
    expect(init.method).toBe('DELETE');
    expect(init.headers.authorization).toBe('Bearer service-role-key-for-tests-only');
    stub(404);
    await expect(admin.deleteUser(USER)).resolves.toBeUndefined();
    stub(500);
    await expect(admin.deleteUser(USER)).rejects.toThrow('500');
    await expect(admin.deleteUser('not-a-uuid')).rejects.toThrow();
    await expect(createAuthAdmin(testEnv()).deleteUser(USER)).rejects.toThrow('configured');
  });
});
