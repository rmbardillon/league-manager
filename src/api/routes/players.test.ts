import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import express from 'express';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';

import type { AuthUser } from '../../domain/authorize.js';

/**
 * DB-less HTTP route tests for the master-Player router
 * (`createPlayersRouter`, Task 11.4; Req 1.5, 4.2 + the create/update/delete
 * status mapping of Requirement 1).
 *
 * The router bakes in `authenticate()` (which reads a session cookie and the
 * database) and delegates every rule to the real `playerService` (which hits
 * the database). To keep the test fully DB-less:
 *
 *   - `../../db/client.js` is mocked so importing the router barrel never opens
 *     a real postgres connection.
 *   - `../middleware/auth.js` is mocked so `authenticate()` becomes a
 *     pass-through that attaches a test-controlled principal to `req.auth`,
 *     while `authorizeRequest` keeps its REAL implementation (the pure
 *     `authorize` decision still runs against the attached principal).
 *   - every `playerService` method the router calls is spied with `vi.spyOn`,
 *     so each test drives a status purely from the stubbed service outcome.
 *
 * The router is mounted on a throwaway Express app together with the central
 * `errorHandler`, so a typed `DomainError` thrown by the stubbed service maps
 * to its HTTP status (400/401/403/404/409) exactly as it would in production,
 * and requests are driven over HTTP with `fetch`.
 */

// Avoid opening a real postgres connection when the router barrel imports the
// db client transitively — the stubbed service never issues a query.
vi.mock('../../db/client.js', () => ({
  sql: {},
  db: {},
}));

// Keep `authorizeRequest` real (so the pure `authorize` decision runs and can
// deny), but turn `authenticate()` into a pass-through that attaches the
// current test principal to `req.auth`.
let currentPrincipal: AuthUser = {
  id: 'admin-1',
  role: 'Administrator',
  managedTeamIds: [],
};

vi.mock('../middleware/auth.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../middleware/auth.js')>();
  return {
    ...actual,
    authenticate: () => (req: express.Request, _res: express.Response, next: express.NextFunction) => {
      req.auth = { sessionId: 'test-session', user: currentPrincipal };
      next();
    },
  };
});

// Imports that depend on the mocks above must come after the `vi.mock` calls.
const { createPlayersRouter } = await import('./players.js');
const { playerService } = await import('../../services/playerService.js');
const { NotFoundError, ValidationError, ConflictError, AuthorizationError } = await import(
  '../../domain/errors.js'
);
import type { Player, PlayerHistoryEntry } from '../../domain/types.js';

/** Start the players router on an ephemeral port and return its base URL. */
async function startServer(): Promise<{ url: string; server: Server }> {
  const { errorHandler } = await import('../middleware/errorHandler.js');
  const app = express();
  app.use(express.json());
  app.use('/players', createPlayersRouter());
  app.use(errorHandler);
  const server = await new Promise<Server>((resolve) => {
    const s = app.listen(0, () => resolve(s));
  });
  const { port } = server.address() as AddressInfo;
  return { url: `http://127.0.0.1:${port}`, server };
}

/** Run `fn` against a freshly started server, always closing it afterwards. */
async function withServer<T>(fn: (url: string) => Promise<T>): Promise<T> {
  const { url, server } = await startServer();
  try {
    return await fn(url);
  } finally {
    server.close();
  }
}

const player: Player = { id: 'p-1', name: 'Ada Lovelace' };

beforeEach(() => {
  currentPrincipal = { id: 'admin-1', role: 'Administrator', managedTeamIds: [] };
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('POST /players', () => {
  it('creates a master Player and returns 201 with the created body', async () => {
    const spy = vi.spyOn(playerService, 'createPlayer').mockResolvedValue(player);

    await withServer(async (url) => {
      const res = await fetch(`${url}/players`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name: 'Ada Lovelace' }),
      });
      expect(res.status).toBe(201);
      expect(await res.json()).toEqual(player);
    });

    expect(spy).toHaveBeenCalledWith(
      currentPrincipal,
      { name: 'Ada Lovelace' },
      expect.anything(),
    );
  });

  it('maps a ValidationError from the service to 400', async () => {
    vi.spyOn(playerService, 'createPlayer').mockRejectedValue(
      new ValidationError('Player name must be between 1 and 100 characters.', {
        field: 'name',
      }),
    );

    await withServer(async (url) => {
      const res = await fetch(`${url}/players`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name: '' }),
      });
      expect(res.status).toBe(400);
      const body = (await res.json()) as { error: { category: string } };
      expect(body.error.category).toBe('ValidationError');
    });
  });
});

describe('GET /players', () => {
  it('returns 200 with the list of master Players', async () => {
    vi.spyOn(playerService, 'listPlayers').mockResolvedValue([player]);

    await withServer(async (url) => {
      const res = await fetch(`${url}/players`);
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual([player]);
    });
  });
});

describe('GET /players/:playerId', () => {
  it('returns 200 with the Player when it exists', async () => {
    vi.spyOn(playerService, 'getPlayer').mockResolvedValue(player);

    await withServer(async (url) => {
      const res = await fetch(`${url}/players/p-1`);
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual(player);
    });
  });

  it('maps a NotFoundError to 404 (Req 1.5)', async () => {
    vi.spyOn(playerService, 'getPlayer').mockRejectedValue(
      new NotFoundError('Player not found.', { playerId: 'missing' }),
    );

    await withServer(async (url) => {
      const res = await fetch(`${url}/players/missing`);
      expect(res.status).toBe(404);
      const body = (await res.json()) as { error: { category: string } };
      expect(body.error.category).toBe('NotFoundError');
    });
  });
});

describe('PATCH /players/:playerId', () => {
  it('renames the Player and returns 200', async () => {
    const renamed: Player = { id: 'p-1', name: 'Grace Hopper' };
    vi.spyOn(playerService, 'updatePlayer').mockResolvedValue(renamed);

    await withServer(async (url) => {
      const res = await fetch(`${url}/players/p-1`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name: 'Grace Hopper' }),
      });
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual(renamed);
    });
  });

  it('maps a ValidationError to 400', async () => {
    vi.spyOn(playerService, 'updatePlayer').mockRejectedValue(
      new ValidationError('Player name must be between 1 and 100 characters.', {
        field: 'name',
      }),
    );

    await withServer(async (url) => {
      const res = await fetch(`${url}/players/p-1`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name: '' }),
      });
      expect(res.status).toBe(400);
    });
  });

  it('maps a NotFoundError to 404', async () => {
    vi.spyOn(playerService, 'updatePlayer').mockRejectedValue(
      new NotFoundError('Player not found.', { playerId: 'missing' }),
    );

    await withServer(async (url) => {
      const res = await fetch(`${url}/players/missing`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name: 'Grace Hopper' }),
      });
      expect(res.status).toBe(404);
    });
  });
});

describe('DELETE /players/:playerId', () => {
  it('removes the Player and returns 204 with no body', async () => {
    const spy = vi.spyOn(playerService, 'removePlayer').mockResolvedValue(undefined);

    await withServer(async (url) => {
      const res = await fetch(`${url}/players/p-1`, { method: 'DELETE' });
      expect(res.status).toBe(204);
      expect(await res.text()).toBe('');
    });

    expect(spy).toHaveBeenCalledWith(
      currentPrincipal,
      { playerId: 'p-1' },
      expect.anything(),
    );
  });

  it('maps a NotFoundError to 404', async () => {
    vi.spyOn(playerService, 'removePlayer').mockRejectedValue(
      new NotFoundError('Player not found.', { playerId: 'missing' }),
    );

    await withServer(async (url) => {
      const res = await fetch(`${url}/players/missing`, { method: 'DELETE' });
      expect(res.status).toBe(404);
    });
  });

  it('maps a ConflictError to 409 when the Player is still assigned (Req 1.8)', async () => {
    vi.spyOn(playerService, 'removePlayer').mockRejectedValue(
      new ConflictError('Player is still assigned to one or more Teams.', {
        playerId: 'p-1',
        assignments: 2,
      }),
    );

    await withServer(async (url) => {
      const res = await fetch(`${url}/players/p-1`, { method: 'DELETE' });
      expect(res.status).toBe(409);
      const body = (await res.json()) as { error: { category: string } };
      expect(body.error.category).toBe('ConflictError');
    });
  });
});

describe('GET /players/:playerId/history', () => {
  it('returns 200 with the assignment history', async () => {
    const history: PlayerHistoryEntry[] = [
      { assignmentId: 'ra-1', teamId: 't-1', seasonId: 's-1', jerseyNumber: 7 },
    ];
    vi.spyOn(playerService, 'getPlayerHistory').mockResolvedValue(history);

    await withServer(async (url) => {
      const res = await fetch(`${url}/players/p-1/history`);
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual(history);
    });
  });
});

describe('authorization mapping (central errorHandler)', () => {
  it('maps an AuthorizationError thrown by the service to 403', async () => {
    vi.spyOn(playerService, 'listPlayers').mockRejectedValue(
      new AuthorizationError('No role is assigned to the user.'),
    );

    await withServer(async (url) => {
      const res = await fetch(`${url}/players`);
      expect(res.status).toBe(403);
      const body = (await res.json()) as { error: { category: string } };
      expect(body.error.category).toBe('AuthorizationError');
    });
  });

  it('denies a non-admin principal with 403 at the route guard (real authorize)', async () => {
    // A Viewer is denied every mutating operation by the pure `authorize`, so
    // the real `authorizeRequest` guard rejects before the service is reached.
    currentPrincipal = { id: 'v-1', role: 'Viewer', managedTeamIds: [] };
    const spy = vi.spyOn(playerService, 'createPlayer').mockResolvedValue(player);

    await withServer(async (url) => {
      const res = await fetch(`${url}/players`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name: 'Ada Lovelace' }),
      });
      expect(res.status).toBe(403);
    });

    // Non-disclosure: the service was never consulted.
    expect(spy).not.toHaveBeenCalled();
  });
});
