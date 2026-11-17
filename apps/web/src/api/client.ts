/**
 * Fetch wrapper (architecture §11): base URL, bearer JWT, error envelope -> ApiError.
 * Never logs bodies. Location goes in POST bodies only (conventions §6).
 */
export type ErrorFields = Record<string, string>;

export class ApiError extends Error {
  readonly code: string;
  readonly status: number;
  readonly fields: ErrorFields | undefined;
  readonly requestId: string | undefined;
  readonly retryAfterS: number | undefined;

  constructor(init: {
    code: string;
    status: number;
    message?: string;
    fields?: ErrorFields | undefined;
    requestId?: string | undefined;
    retryAfterS?: number | undefined;
  }) {
    super(init.message ?? init.code);
    this.name = 'ApiError';
    this.code = init.code;
    this.status = init.status;
    this.fields = init.fields;
    this.requestId = init.requestId;
    this.retryAfterS = init.retryAfterS;
  }
}

const DEFAULT_BASE = 'http://127.0.0.1:54321/functions/v1/api/v1';

export function apiBaseUrl(): string {
  const v = import.meta.env.VITE_API_BASE_URL;
  return (typeof v === 'string' && v.length > 0 ? v : DEFAULT_BASE).replace(/\/+$/, '');
}

type TokenProvider = () => Promise<string | null> | string | null;
let tokenProvider: TokenProvider = () => null;

/** The auth provider plugs the Supabase session in here. Signed out, requests go out anonymous (public endpoints). */
export function setTokenProvider(fn: TokenProvider): void {
  tokenProvider = fn;
}

export interface RequestOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  query?: Record<string, string | number | undefined>;
  body?: unknown;
  signal?: AbortSignal | undefined;
  headers?: Record<string, string>;
  /** ms, default 10 000 */
  timeoutMs?: number;
  /** Never attach the session token (public pages such as the share link). */
  anonymous?: boolean;
}

export async function apiRequest<T>(path: string, opts: RequestOptions = {}): Promise<T> {
  const url = new URL(`${apiBaseUrl()}${path}`, window.location.origin);
  for (const [k, v] of Object.entries(opts.query ?? {})) {
    if (v !== undefined) url.searchParams.set(k, String(v));
  }

  const headers: Record<string, string> = { Accept: 'application/json', ...opts.headers };
  const isForm = typeof FormData !== 'undefined' && opts.body instanceof FormData;
  // multipart: the browser sets the boundary itself.
  if (opts.body !== undefined && !isForm) headers['Content-Type'] = 'application/json';
  const token = opts.anonymous ? null : await tokenProvider();
  if (token) headers.Authorization = `Bearer ${token}`;

  const timeout = AbortSignal.timeout(opts.timeoutMs ?? 10_000);
  const signal = opts.signal ? AbortSignal.any([opts.signal, timeout]) : timeout;

  let res: Response;
  try {
    const init: RequestInit = { method: opts.method ?? 'GET', headers, signal };
    if (opts.body !== undefined)
      init.body = isForm ? (opts.body as FormData) : JSON.stringify(opts.body);
    res = await fetch(url, init);
  } catch (err) {
    // Caller aborted (for example a newer keystroke): let it propagate untouched.
    if (opts.signal?.aborted) throw err;
    throw new ApiError({ code: 'NETWORK', status: 0, message: 'Network error or timeout' });
  }

  if (res.status === 204) return undefined as T;

  let json: unknown = null;
  try {
    json = await res.json();
  } catch {
    json = null;
  }

  if (!res.ok) {
    const env = (json as { error?: Record<string, unknown> } | null)?.error;
    const retry = Number(res.headers.get('Retry-After'));
    throw new ApiError({
      code: typeof env?.code === 'string' ? env.code : res.status >= 500 ? 'INTERNAL' : 'UNKNOWN',
      status: res.status,
      message: typeof env?.message === 'string' ? env.message : `HTTP ${res.status}`,
      fields: env?.fields as ErrorFields | undefined,
      requestId: typeof env?.requestId === 'string' ? env.requestId : undefined,
      retryAfterS: Number.isFinite(retry) && retry > 0 ? retry : undefined,
    });
  }
  return json as T;
}
