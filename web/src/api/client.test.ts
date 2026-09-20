import { describe, it, expect, afterEach, vi } from 'vitest';
import { ApiError, request } from './client.js';

/** Build a JSON Response with the given status. */
function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

describe('api client request()', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('parses a successful JSON response', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => jsonResponse({ id: 't1', name: 'Hawks' }, 200)),
    );
    const team = await request<{ id: string; name: string }>('/teams/t1');
    expect(team).toEqual({ id: 't1', name: 'Hawks' });
  });

  it('sends credentials: include on every request', async () => {
    const fetchMock = vi.fn(
      async (_input: RequestInfo | URL, _init?: RequestInit) => jsonResponse({}, 200),
    );
    vi.stubGlobal('fetch', fetchMock);
    await request('/auth/me');
    const init = fetchMock.mock.calls[0]?.[1];
    expect(init?.credentials).toBe('include');
  });

  it('maps the error envelope onto a typed ApiError', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        jsonResponse(
          { error: { category: 'ValidationError', message: 'Name is too long.' } },
          400,
        ),
      ),
    );
    await expect(request('/teams', { method: 'POST', body: { name: '' } })).rejects.toMatchObject({
      category: 'ValidationError',
      status: 400,
      message: 'Name is too long.',
    });
  });

  it('flags 401 responses as unauthenticated', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        jsonResponse(
          { error: { category: 'AuthenticationError', message: 'Session expired.' } },
          401,
        ),
      ),
    );
    try {
      await request('/manage');
      expect.unreachable('request should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(ApiError);
      expect((err as ApiError).isUnauthenticated).toBe(true);
    }
  });

  it('resolves a 204 no-content response to undefined', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(null, { status: 204 })),
    );
    await expect(request('/teams/t1', { method: 'DELETE' })).resolves.toBeUndefined();
  });
});
