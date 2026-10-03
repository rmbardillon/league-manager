import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import express from 'express';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';

import type { AuthUser } from '../../domain/authorize.js';

/**
 * DB-less HTTP route tests for the team-scoped assignment router
 * (`createAssignmentsRouter`, Task 11.4; Req 2.3, 2.6, 3.1, 3.2, 4.2 + the
 * assign/jersey status mapping of Requirements 2, 3).
 *
 * Mirrors `players.test.ts`: `../../db/client.js` is mocked so no real postgres
 * connection opens, `authenticate()` is replaced with a pass-through that
 * attaches a test-controlled principal while the REAL `authorizeRequest` runs
 * the pure team-scoped `authorize` decision, and every `playerService` method
 * the router calls is spied. The router is mounted with the central
 * `errorHandler` on an ephemeral server and driven over HTTP with `fetch`.
 *
 * Both 403 non-disclosure routes are covered: one driven by the real
 * `authorize` denying a Team_Manager acting on an unmanaged Team (the service
 * is never reached), and one driven by the stubbed service throwing an
 * `AuthorizationError`.
 */

vi.mock('../../db/client.js', () => ({
  sql: {},
  db: {},
}));

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

const { createAssignmentsRouter } = await import('./assignments.js');
const { playerService } = await import('../../services/playerService.js');
const { NotFoundError, ValidationError, ConflictError, AuthorizationError } = await import(
  '../../domain/errors.js'
);
import type { RosterAssignment, RosterEntry } from '../../domain/types.js';

async function startServer(): Promise<{ url: string; server: Server }> {
  const { errorHandler } = await import('../middleware/errorHandler.js');
  const app = express();
  app.use(express.json());
  app.use('/teams', createAssignmentsRouter());
  app.use(errorHandler);
  const server = await new Promise<Server>((resolve) => {
    const s = app.listen(0, () => resolve(s));
  });
  const { port } = server.address() as AddressInfo;
  return { url: `http://127.0.0.1:${port}`, server };
}

async function withServer<T>(fn: (url: string) => Promise<T>): Promise<T> {
  const { url, server } = await startServer();
  try {
    return await fn(url);
  } finally {
    server.close();
  }
}

const assignment: RosterAssignment = {
  id: 'ra-1',
  playerId: 'p-1',
  teamId: 't-1',
  jerseyNumber: 7,
};

beforeEach(() => {
  currentPrincipal = { id: 'admin-1', role: 'Administrator', managedTeamIds: [] };
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('POST /teams/:teamId/assignments', () => {
  it('assigns a Player and returns 201 with the created assignment', async () => {
    const spy = vi.spyOn(playerService, 'assignPlayer').mockResolvedValue(assignment);

    await withServer(async (url) => {
      const res = await fetch(`${url}/teams/t-1/assignments`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ playerId: 'p-1', jerseyNumber: 7 }),
      });
      expect(res.status).toBe(201);
      expect(await res.json()).toEqual(assignment);
    });

    expect(spy).toHaveBeenCalledWith(
      currentPrincipal,
      { teamId: 't-1', playerId: 'p-1', jerseyNumber: 7 },
      expect.anything(),
    );
  });

  it('maps a ValidationError (bad jersey) to 400 (Req 3.1)', async () => {
    vi.spyOn(playerService, 'assignPlayer').mockRejectedValue(
      new ValidationError('Jersey number must be an integer between 0 and 99.', {
        field: 'jerseyNumber',
      }),
    );

    await withServer(async (url) => {
      const res = await fetch(`${url}/teams/t-1/assignments`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ playerId: 'p-1', jerseyNumber: 100 }),
      });
      expect(res.status).toBe(400);
      const body = (await res.json()) as { error: { category: string } };
      expect(body.error.category).toBe('ValidationError');
    });
  });

  it('maps a ConflictError (jersey already in use) to 409 (Req 3.1)', async () => {
    vi.spyOn(playerService, 'assignPlayer').mockRejectedValue(
      new ConflictError('Jersey number is already in use on this Team.', {
        teamId: 't-1',
        jerseyNumber: 7,
      }),
    );

    await withServer(async (url) => {
      const res = await fetch(`${url}/teams/t-1/assignments`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ playerId: 'p-1', jerseyNumber: 7 }),
      });
      expect(res.status).toBe(409);
      const body = (await res.json()) as { error: { category: string } };
      expect(body.error.category).toBe('ConflictError');
    });
  });

  it('maps a ConflictError (one-per-season) to 409 (Req 3.2)', async () => {
    vi.spyOn(playerService, 'assignPlayer').mockRejectedValue(
      new ConflictError('Player is already assigned to a Team in that Season.', {
        playerId: 'p-1',
        seasonId: 's-1',
      }),
    );

    await withServer(async (url) => {
      const res = await fetch(`${url}/teams/t-1/assignments`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ playerId: 'p-1', jerseyNumber: 9 }),
      });
      expect(res.status).toBe(409);
    });
  });

  it('maps a NotFoundError (unknown Team or Player) to 404', async () => {
    vi.spyOn(playerService, 'assignPlayer').mockRejectedValue(
      new NotFoundError('Team not found.', { teamId: 'missing' }),
    );

    await withServer(async (url) => {
      const res = await fetch(`${url}/teams/missing/assignments`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ playerId: 'p-1', jerseyNumber: 9 }),
      });
      expect(res.status).toBe(404);
    });
  });
});

describe('PATCH /teams/:teamId/assignments/:playerId', () => {
  it('updates the jersey and returns 200', async () => {
    const updated: RosterAssignment = { ...assignment, jerseyNumber: 23 };
    const spy = vi
      .spyOn(playerService, 'updateAssignmentJersey')
      .mockResolvedValue(updated);

    await withServer(async (url) => {
      const res = await fetch(`${url}/teams/t-1/assignments/p-1`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ jerseyNumber: 23 }),
      });
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual(updated);
    });

    expect(spy).toHaveBeenCalledWith(
      currentPrincipal,
      { teamId: 't-1', playerId: 'p-1', jerseyNumber: 23 },
      expect.anything(),
    );
  });

  it('maps a NotFoundError (no such assignment) to 404 (Req 2.6)', async () => {
    vi.spyOn(playerService, 'updateAssignmentJersey').mockRejectedValue(
      new NotFoundError('No assignment for that Player on that Team.', {
        playerId: 'p-1',
        teamId: 't-1',
      }),
    );

    await withServer(async (url) => {
      const res = await fetch(`${url}/teams/t-1/assignments/p-1`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ jerseyNumber: 23 }),
      });
      expect(res.status).toBe(404);
    });
  });

  it('maps a ConflictError (jersey taken) to 409 (Req 3.1)', async () => {
    vi.spyOn(playerService, 'updateAssignmentJersey').mockRejectedValue(
      new ConflictError('Jersey number is already in use on this Team.', {
        teamId: 't-1',
        jerseyNumber: 23,
      }),
    );

    await withServer(async (url) => {
      const res = await fetch(`${url}/teams/t-1/assignments/p-1`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ jerseyNumber: 23 }),
      });
      expect(res.status).toBe(409);
    });
  });
});

describe('DELETE /teams/:teamId/assignments/:playerId', () => {
  it('unassigns the Player and returns 204 with no body (Req 2.5)', async () => {
    const spy = vi.spyOn(playerService, 'unassignPlayer').mockResolvedValue(undefined);

    await withServer(async (url) => {
      const res = await fetch(`${url}/teams/t-1/assignments/p-1`, {
        method: 'DELETE',
      });
      expect(res.status).toBe(204);
      expect(await res.text()).toBe('');
    });

    expect(spy).toHaveBeenCalledWith(
      currentPrincipal,
      { teamId: 't-1', playerId: 'p-1' },
      expect.anything(),
    );
  });

  it('maps a NotFoundError (no such assignment) to 404 (Req 2.6)', async () => {
    vi.spyOn(playerService, 'unassignPlayer').mockRejectedValue(
      new NotFoundError('No assignment for that Player on that Team.', {
        playerId: 'p-1',
        teamId: 't-1',
      }),
    );

    await withServer(async (url) => {
      const res = await fetch(`${url}/teams/t-1/assignments/p-1`, {
        method: 'DELETE',
      });
      expect(res.status).toBe(404);
    });
  });
});

describe('GET /teams/:teamId/roster', () => {
  it('returns 200 with the roster (including an empty roster, Req 4.2)', async () => {
    const roster: RosterEntry[] = [
      { playerId: 'p-1', name: 'Ada Lovelace', jerseyNumber: 7 },
    ];
    vi.spyOn(playerService, 'getTeamRoster').mockResolvedValue(roster);

    await withServer(async (url) => {
      const res = await fetch(`${url}/teams/t-1/roster`);
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual(roster);
    });
  });

  it('returns 200 with an empty array for a Team with no assignments (Req 4.2)', async () => {
    vi.spyOn(playerService, 'getTeamRoster').mockResolvedValue([]);

    await withServer(async (url) => {
      const res = await fetch(`${url}/teams/t-empty/roster`);
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual([]);
    });
  });
});

describe('team-scoped authorization non-disclosure (Req 2.3, 9.2)', () => {
  it('denies a Team_Manager on an unmanaged Team with 403 at the route guard', async () => {
    // Real `authorizeRequest` runs the pure `authorize`: a Team_Manager whose
    // managed set excludes the path teamId is denied before any read, so the
    // service is never consulted and existence is never disclosed.
    currentPrincipal = {
      id: 'tm-1',
      role: 'Team_Manager',
      managedTeamIds: ['t-other'],
    };
    const spy = vi.spyOn(playerService, 'assignPlayer').mockResolvedValue(assignment);

    await withServer(async (url) => {
      const res = await fetch(`${url}/teams/t-1/assignments`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ playerId: 'p-1', jerseyNumber: 7 }),
      });
      expect(res.status).toBe(403);
      const body = (await res.json()) as { error: { category: string } };
      expect(body.error.category).toBe('AuthorizationError');
    });

    expect(spy).not.toHaveBeenCalled();
  });

  it('maps an AuthorizationError thrown by the service to 403', async () => {
    // Even when the route guard admits (e.g. a managed Team), a service-side
    // AuthorizationError still maps to 403 via the central errorHandler.
    currentPrincipal = {
      id: 'tm-1',
      role: 'Team_Manager',
      managedTeamIds: ['t-1'],
    };
    vi.spyOn(playerService, 'assignPlayer').mockRejectedValue(
      new AuthorizationError('The user is not authorized for that Team.'),
    );

    await withServer(async (url) => {
      const res = await fetch(`${url}/teams/t-1/assignments`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ playerId: 'p-1', jerseyNumber: 7 }),
      });
      expect(res.status).toBe(403);
      const body = (await res.json()) as { error: { category: string } };
      expect(body.error.category).toBe('AuthorizationError');
    });
  });
});
