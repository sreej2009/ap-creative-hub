/**
 * Fetch wrapper for the A&P API. Sends cookies, attaches the CSRF token to
 * state-changing requests, and normalises errors into ApiError.
 */
const API_BASE = (import.meta.env.VITE_API_URL as string | undefined)?.replace(/\/$/, '') ?? '';

export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    public details?: Record<string, unknown> & { quote?: unknown },
  ) {
    super(message);
    this.name = 'ApiError';
  }
  /** Field-level validation messages, if any. */
  get fieldErrors(): Record<string, string> {
    if (this.code !== 'VALIDATION_ERROR' || !this.details) return {};
    return Object.fromEntries(Object.entries(this.details).filter(([, v]) => typeof v === 'string')) as Record<string, string>;
  }
}

let csrfToken: string | null = null;
let csrfPromise: Promise<string> | null = null;

function readCsrfCookie(): string | null {
  const match = document.cookie.match(/(?:^|;\s*)aph_csrf=([^;]+)/);
  return match ? decodeURIComponent(match[1]) : null;
}

async function fetchCsrf(): Promise<string> {
  csrfPromise ??= fetch(`${API_BASE}/api/v1/auth/csrf`, { credentials: 'include' })
    .then((r) => r.json())
    .then((d: { csrfToken: string }) => (csrfToken = d.csrfToken))
    .finally(() => (csrfPromise = null));
  return csrfPromise;
}

async function currentCsrf(): Promise<string> {
  return readCsrfCookie() ?? csrfToken ?? (await fetchCsrf());
}

type Query = Record<string, string | number | boolean | null | undefined>;

export interface RequestOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  body?: unknown;
  query?: Query;
  signal?: AbortSignal;
}

export function buildQuery(query?: Query) {
  if (!query) return '';
  const params = new URLSearchParams();
  for (const [k, v] of Object.entries(query)) {
    if (v === undefined || v === null || v === '') continue;
    params.set(k, String(v));
  }
  const s = params.toString();
  return s ? `?${s}` : '';
}

async function request<T>(path: string, opts: RequestOptions = {}, retried = false): Promise<T> {
  const method = opts.method ?? 'GET';
  const headers: Record<string, string> = { Accept: 'application/json' };
  const isForm = typeof FormData !== 'undefined' && opts.body instanceof FormData;
  if (opts.body !== undefined && !isForm) headers['Content-Type'] = 'application/json';
  if (method !== 'GET') headers['X-CSRF-Token'] = await currentCsrf();

  let res: Response;
  try {
    res = await fetch(`${API_BASE}/api/v1${path}${buildQuery(opts.query)}`, {
      method,
      headers,
      credentials: 'include',
      signal: opts.signal,
      body: opts.body === undefined ? undefined : isForm ? (opts.body as FormData) : JSON.stringify(opts.body),
    });
  } catch (err) {
    if ((err as Error).name === 'AbortError') throw err;
    throw new ApiError(0, 'NETWORK_ERROR', 'Could not reach the server. Check your connection and try again.');
  }

  const isJson = res.headers.get('content-type')?.includes('application/json');
  const data = isJson ? await res.json().catch(() => null) : null;

  if (!res.ok) {
    const err = data?.error ?? {};
    if (res.status === 403 && err.code === 'CSRF_INVALID' && !retried) {
      csrfToken = null;
      await fetchCsrf();
      return request<T>(path, opts, true);
    }
    throw new ApiError(res.status, err.code ?? 'HTTP_ERROR', err.message ?? `Request failed (${res.status})`, err.details);
  }
  return data as T;
}

export const api = {
  get: <T>(path: string, query?: Query, signal?: AbortSignal) => request<T>(path, { query, signal }),
  post: <T>(path: string, body?: unknown) => request<T>(path, { method: 'POST', body: body ?? {} }),
  put: <T>(path: string, body?: unknown) => request<T>(path, { method: 'PUT', body: body ?? {} }),
  patch: <T>(path: string, body?: unknown) => request<T>(path, { method: 'PATCH', body: body ?? {} }),
  delete: <T>(path: string, query?: Query) => request<T>(path, { method: 'DELETE', query }),
  upload: <T>(path: string, form: FormData) => request<T>(path, { method: 'POST', body: form }),
  /** Absolute URL for downloads (e.g. CSV export) that rely on cookies. */
  url: (path: string, query?: Query) => `${API_BASE}/api/v1${path}${buildQuery(query)}`,
  warmCsrf: () => fetchCsrf().catch(() => undefined),
};

export function errorMessage(err: unknown, fallback = 'Something went wrong. Please try again.') {
  if (err instanceof ApiError) return err.message;
  if (err instanceof Error && err.message) return err.message;
  return fallback;
}
