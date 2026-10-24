import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiError, api } from './api';

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

afterEach(() => {
  vi.restoreAllMocks();
  document.cookie = 'aph_csrf=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/';
});

describe('api client', () => {
  it('sends the CSRF cookie value as a header on mutations, with credentials', async () => {
    document.cookie = 'aph_csrf=tok.sig; path=/';
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(json(200, { ok: true }));
    await api.post('/cart/quote', { items: [] });
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('/api/v1/cart/quote');
    expect((init as RequestInit).credentials).toBe('include');
    expect((init as RequestInit).headers).toMatchObject({ 'X-CSRF-Token': 'tok.sig', 'Content-Type': 'application/json' });
  });

  it('refreshes the CSRF token and retries once when it is rejected', async () => {
    document.cookie = 'aph_csrf=stale.sig; path=/';
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(json(403, { error: { code: 'CSRF_INVALID', message: 'expired' } }))
      .mockResolvedValueOnce(json(200, { csrfToken: 'fresh.sig' }))
      .mockResolvedValueOnce(json(201, { done: true }));
    const res = await api.post<{ done: boolean }>('/contact', {});
    expect(res.done).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(fetchMock.mock.calls[1][0]).toBe('/api/v1/auth/csrf');
  });

  it('normalises API errors including field details', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      json(400, { error: { code: 'VALIDATION_ERROR', message: 'Some fields are invalid.', details: { email: 'Enter a valid email address' } } }),
    );
    const err = (await api.get('/products').catch((e: unknown) => e)) as ApiError;
    expect(err).toBeInstanceOf(ApiError);
    expect(err.status).toBe(400);
    expect(err.fieldErrors).toEqual({ email: 'Enter a valid email address' });
  });

  it('reports network failures clearly', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new TypeError('Failed to fetch'));
    await expect(api.get('/home')).rejects.toMatchObject({ code: 'NETWORK_ERROR', status: 0 });
  });
});
