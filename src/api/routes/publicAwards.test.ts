import { describe, it, expect, vi, afterEach } from 'vitest';
import express from 'express';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';

import { createPublicRouter, type PublishedAwardsPayload } from './public.js';
import type { Award } from '../../domain/types.js';
import type { Database } from '../../repositories/executor.js';
import { awardRepository } from '../../repositories/index.js';

/**
 * Public published-Awards route tests (Req 13.14, 13.15).
 *
 * The route reads Awards through `awardRepository.listByScope` (spied here) and
 * filters to the published subset, so it needs no live database. The router is
 * mounted on a throwaway Express server and driven over HTTP with `fetch`.
 */

const dummyDb = {} as unknown as Database;

function award(overrides: Partial<Award>): Award {
  return {
    id: 'a-1',
    scopeId: 'scope-1',
    category: 'MVP',
    playerIds: ['p-1'],
    published: false,
    ...overrides,
  };
}

/** Start the public router on an ephemeral port and return its base URL. */
async function startServer(): Promise<{ url: string; server: Server }> {
  const app = express();
  app.use('/public', createPublicRouter(dummyDb));
  const server = await new Promise<Server>((resolve) => {
    const s = app.listen(0, () => resolve(s));
  });
  const { port } = server.address() as AddressInfo;
  return { url: `http://127.0.0.1:${port}`, server };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('GET /public/scopes/:scopeId/awards', () => {
  it('returns only published Awards for the scope (Req 13.15)', async () => {
    vi.spyOn(awardRepository, 'listByScope').mockResolvedValue([
      award({ id: 'a-pub', category: 'MVP', published: true }),
      award({ id: 'a-hidden', category: 'DPOY', published: false }),
    ]);

    const { url, server } = await startServer();
    try {
      const res = await fetch(`${url}/public/scopes/scope-1/awards`);
      expect(res.status).toBe(200);
      const body = (await res.json()) as PublishedAwardsPayload;
      expect(body.scopeId).toBe('scope-1');
      expect(body.awards.map((a) => a.id)).toEqual(['a-pub']);
      expect(body.message).toBeUndefined();
    } finally {
      server.close();
    }
  });

  it('returns an empty list with an informational message (never a 404) for a scope with no published Awards', async () => {
    vi.spyOn(awardRepository, 'listByScope').mockResolvedValue([
      award({ id: 'a-hidden', published: false }),
    ]);

    const { url, server } = await startServer();
    try {
      const res = await fetch(`${url}/public/scopes/unknown/awards`);
      expect(res.status).toBe(200);
      const body = (await res.json()) as PublishedAwardsPayload;
      expect(body.awards).toEqual([]);
      expect(body.message).toBeDefined();
    } finally {
      server.close();
    }
  });
});
