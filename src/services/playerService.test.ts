/**
 * PlayerService property-based test suite (DB-less).
 *
 * These tests exercise `playerService` without a real database. The service
 * imports `db` from `../db/client.js` and runs its transactional methods via
 * `withTransaction(db, cb)` → `db.transaction(cb)`; we mock that module so the
 * transaction simply invokes the callback in-process with a marker tx. Every
 * repository method the service touches is spied via `vi.spyOn` on the
 * singletons exported from `../repositories/index.js`, so each property asserts
 * what the service reads/writes rather than hitting a database.
 *
 * All properties use `fast-check` with a minimum of 100 runs and are tagged
 * `// Feature: player-master-data, Property N: <text>`.
 *
 * Covers tasks 5.2, 5.3, 5.4, 5.6, 5.7, 5.8, 5.9, 5.11 of the
 * player-master-data spec.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import fc from 'fast-check';

// Mock the db client so `withTransaction(db, cb)` runs `cb` in-process with a
// marker transaction. This is the DB-less shape used by batchUploadService.test
// (there via injection); here the service imports `db` directly, so we mock it.
vi.mock('../db/client.js', () => ({
  db: {
    transaction: (cb: (tx: unknown) => unknown) => cb({ marker: 'tx' }),
  },
}));

import { playerService } from './playerService.js';
import type { AuthUser } from '../domain/authorize.js';
import {
  AuthorizationError,
  ConflictError,
  NotFoundError,
} from '../domain/errors.js';
import type {
  Player,
  RosterAssignment,
  Team,
} from '../domain/types.js';
import {
  playerRepository,
  rosterAssignmentRepository,
  teamRepository,
  type Executor,
} from '../repositories/index.js';

// ---------------------------------------------------------------------------
// Fixtures & arbitraries
// ---------------------------------------------------------------------------

/** The marker executor passed to service methods; the mock ignores its shape. */
const ex = {} as unknown as Executor;

const admin: AuthUser = {
  id: 'admin-1',
  role: 'Administrator',
  managedTeamIds: [],
};

/** A Team_Manager who manages exactly `teamId`. */
function manager(teamId: string): AuthUser {
  return { id: 'tm-1', role: 'Team_Manager', managedTeamIds: [teamId] };
}

const viewer: AuthUser = { id: 'v-1', role: 'Viewer', managedTeamIds: [] };

/** A non-empty id-ish string. */
const id = fc.string({ minLength: 1, maxLength: 12 });

/** A valid Player name (1–100 chars). */
const validName = fc.string({ minLength: 1, maxLength: 100 });

/** A valid jersey number (0–99 integer). */
const jersey = fc.integer({ min: 0, max: 99 });

function makePlayer(overrides: Partial<Player> = {}): Player {
  return { id: 'p-1', name: 'Alice', ...overrides };
}

function makeTeam(overrides: Partial<Team> = {}): Team {
  return { id: 't-1', seasonId: 's-1', name: 'Warriors', ...overrides };
}

function makeAssignment(
  overrides: Partial<RosterAssignment> = {},
): RosterAssignment {
  return {
    id: 'a-1',
    playerId: 'p-1',
    teamId: 't-1',
    jerseyNumber: 10,
    ...overrides,
  };
}

/** Restore all spies after each test so properties don't leak stubs. */
afterEach(() => {
  vi.restoreAllMocks();
});

// ---------------------------------------------------------------------------
// Property 1 (task 5.2) — master Player identity shape & non-unique names
// ---------------------------------------------------------------------------

describe('Property 1: master Player identity shape and non-unique names', () => {
  // Feature: player-master-data, Property 1: a created master Player is exactly { id, name } with the submitted name, created names need not be unique, and getPlayer returns the same identity for an id that exists. (Validates Requirements 1.1, 1.3, 1.4)
  it('creates { id, name } with the submitted name; duplicate names allowed; getPlayer round-trips', async () => {
    await fc.assert(
      fc.asyncProperty(id, validName, validName, async (pid, nameA, nameB) => {
        // Two creates with (possibly) identical names both succeed — no
        // uniqueness check (Req 1.3). The repository echoes the submitted name
        // back under a server-assigned id.
        const create = vi
          .spyOn(playerRepository, 'create')
          .mockImplementation(async (input) =>
            makePlayer({ id: pid, name: input.name }),
          );

        const a = await playerService.createPlayer(admin, { name: nameA }, ex);
        const b = await playerService.createPlayer(admin, { name: nameB }, ex);

        // Identity shape: exactly { id, name }, name preserved (Req 1.1).
        expect(Object.keys(a).sort()).toEqual(['id', 'name']);
        expect(a.name).toBe(nameA);
        expect(b.name).toBe(nameB);
        // Non-unique names: both creates were accepted (Req 1.3).
        expect(create).toHaveBeenCalledTimes(2);

        // getPlayer returns the same identity for an existing id (Req 1.4).
        const found = makePlayer({ id: pid, name: nameA });
        vi.spyOn(playerRepository, 'findById').mockResolvedValue(found);
        const got = await playerService.getPlayer(admin, { playerId: pid }, ex);
        expect(got).toEqual(found);
        expect(Object.keys(got).sort()).toEqual(['id', 'name']);
      }),
      { numRuns: 100 },
    );
  });
});

// ---------------------------------------------------------------------------
// Property 2 (task 5.3) — rename preserves assignments
// ---------------------------------------------------------------------------

describe('Property 2: rename preserves assignments', () => {
  // Feature: player-master-data, Property 2: updatePlayer changes only the master name via playerRepository.update({ name }) and never touches any roster assignment (no rosterAssignmentRepository mutation). (Validates Requirements 1.6)
  it('updatePlayer calls playerRepository.update({ name }) and never mutates a roster assignment', async () => {
    await fc.assert(
      fc.asyncProperty(id, validName, validName, async (pid, oldName, newName) => {
        vi.spyOn(playerRepository, 'findById').mockResolvedValue(
          makePlayer({ id: pid, name: oldName }),
        );
        const update = vi
          .spyOn(playerRepository, 'update')
          .mockImplementation(async (uid, patch) =>
            makePlayer({ id: uid, name: patch.name ?? oldName }),
          );

        // Spy every assignment mutation so we can assert none is invoked.
        const assignCreate = vi.spyOn(rosterAssignmentRepository, 'create');
        const assignCreateMany = vi.spyOn(rosterAssignmentRepository, 'createMany');
        const assignUpdate = vi.spyOn(rosterAssignmentRepository, 'updateJersey');
        const assignDelete = vi.spyOn(rosterAssignmentRepository, 'delete');

        const result = await playerService.updatePlayer(
          admin,
          { playerId: pid, name: newName },
          ex,
        );

        // Only the name changed, via the master-player update (Req 1.6).
        expect(result).toEqual(makePlayer({ id: pid, name: newName }));
        expect(update).toHaveBeenCalledTimes(1);
        expect(update.mock.calls[0]![1]).toEqual({ name: newName });

        // No roster assignment was created, changed, or removed (Req 1.6).
        expect(assignCreate).not.toHaveBeenCalled();
        expect(assignCreateMany).not.toHaveBeenCalled();
        expect(assignUpdate).not.toHaveBeenCalled();
        expect(assignDelete).not.toHaveBeenCalled();
      }),
      { numRuns: 100 },
    );
  });
});

// ---------------------------------------------------------------------------
// Property 3 (task 5.4) — deletion gating
// ---------------------------------------------------------------------------

describe('Property 3: deletion gating', () => {
  // Feature: player-master-data, Property 3: removePlayer deletes the master Player iff it holds no roster assignments; when listByPlayer is non-empty it throws ConflictError and performs no delete. (Validates Requirements 1.8, 1.9)
  it('deletes iff no assignments; else ConflictError and no delete', async () => {
    await fc.assert(
      fc.asyncProperty(
        id,
        fc.array(makeAssignmentArb(), { maxLength: 5 }),
        async (pid, assignments) => {
          vi.spyOn(playerRepository, 'findById').mockResolvedValue(
            makePlayer({ id: pid }),
          );
          vi.spyOn(rosterAssignmentRepository, 'listByPlayer').mockResolvedValue(
            assignments,
          );
          const del = vi
            .spyOn(playerRepository, 'delete')
            .mockResolvedValue(true);

          if (assignments.length === 0) {
            // No assignments → delete proceeds (Req 1.9).
            await expect(
              playerService.removePlayer(admin, { playerId: pid }, ex),
            ).resolves.toBeUndefined();
            expect(del).toHaveBeenCalledTimes(1);
            expect(del.mock.calls[0]![0]).toBe(pid);
          } else {
            // Still assigned → ConflictError and no delete (Req 1.8).
            await expect(
              playerService.removePlayer(admin, { playerId: pid }, ex),
            ).rejects.toBeInstanceOf(ConflictError);
            expect(del).not.toHaveBeenCalled();
          }
        },
      ),
      { numRuns: 100 },
    );
  });
});

/** Arbitrary RosterAssignment with varied, structurally-valid fields. */
function makeAssignmentArb(): fc.Arbitrary<RosterAssignment> {
  return fc.record({
    id,
    playerId: id,
    teamId: id,
    jerseyNumber: jersey,
  });
}

// ---------------------------------------------------------------------------
// Property 4 (task 5.6) — jersey uniqueness within a Team
// ---------------------------------------------------------------------------

describe('Property 4: jersey uniqueness within a Team', () => {
  // Feature: player-master-data, Property 4: assignPlayer rejects with ConflictError when the requested jersey is already used on the Team roster, and accepts a free 0–99 jersey. (Validates Requirements 2.7, 3.1)
  it('rejects a taken jersey with ConflictError; accepts a free one', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.uniqueArray(jersey, { minLength: 1, maxLength: 20 }),
        jersey,
        async (taken, requested) => {
          const teamId = 't-1';
          const playerId = 'p-free';
          const seasonId = 's-1';

          // Roster currently uses every jersey in `taken`.
          const roster: RosterAssignment[] = taken.map((j, i) =>
            makeAssignment({
              id: `a-${i}`,
              playerId: `p-${i}`,
              teamId,
              jerseyNumber: j,
            }),
          );

          vi.spyOn(teamRepository, 'findById').mockResolvedValue(
            makeTeam({ id: teamId, seasonId }),
          );
          vi.spyOn(playerRepository, 'findById').mockResolvedValue(
            makePlayer({ id: playerId }),
          );
          vi.spyOn(rosterAssignmentRepository, 'listByTeam').mockResolvedValue(
            roster,
          );
          // No same-season assignment for the new player, so the season guard
          // never blocks — isolating the jersey rule under test.
          vi.spyOn(
            rosterAssignmentRepository,
            'listByPlayerInSeason',
          ).mockResolvedValue([]);
          const create = vi
            .spyOn(rosterAssignmentRepository, 'create')
            .mockImplementation(async (input) =>
              makeAssignment({ ...input, id: 'a-new' }),
            );

          const act = playerService.assignPlayer(
            admin,
            { teamId, playerId, jerseyNumber: requested },
            ex,
          );

          if (taken.includes(requested)) {
            // Jersey already on the roster → ConflictError, no create (Req 3.1).
            await expect(act).rejects.toBeInstanceOf(ConflictError);
            expect(create).not.toHaveBeenCalled();
          } else {
            // Free jersey in range → accepted and created (Req 2.7, 3.1).
            const result = await act;
            expect(result.jerseyNumber).toBe(requested);
            expect(create).toHaveBeenCalledTimes(1);
            expect(create.mock.calls[0]![0]).toEqual({
              playerId,
              teamId,
              jerseyNumber: requested,
            });
          }
        },
      ),
      { numRuns: 100 },
    );
  });
});

// ---------------------------------------------------------------------------
// Property 5 (task 5.7) — one assignment per Player per Season (cross-Season ok)
// ---------------------------------------------------------------------------

describe('Property 5: one assignment per Player per Season (cross-Season allowed)', () => {
  // Feature: player-master-data, Property 5: assignPlayer rejects with ConflictError when the Player already holds an assignment in the target Team's Season, and accepts when they hold none in that Season (assignments in other Seasons do not block). (Validates Requirements 3.2, 3.3)
  it('rejects when a same-Season assignment exists; accepts when none does', async () => {
    await fc.assert(
      fc.asyncProperty(
        id,
        id,
        fc.boolean(),
        async (playerId, seasonId, hasSameSeason) => {
          const teamId = 't-1';

          vi.spyOn(teamRepository, 'findById').mockResolvedValue(
            makeTeam({ id: teamId, seasonId }),
          );
          vi.spyOn(playerRepository, 'findById').mockResolvedValue(
            makePlayer({ id: playerId }),
          );
          // Empty roster so jersey 0 is always free — isolating the season rule.
          vi.spyOn(rosterAssignmentRepository, 'listByTeam').mockResolvedValue(
            [],
          );
          // listByPlayerInSeason returns the target Season's assignments only;
          // the service queries exactly (playerId, team.seasonId). A non-empty
          // result models a same-Season assignment; empty models either none at
          // all, or only cross-Season assignments (which do not block, Req 3.3).
          const sameSeason = vi
            .spyOn(rosterAssignmentRepository, 'listByPlayerInSeason')
            .mockResolvedValue(
              hasSameSeason
                ? [makeAssignment({ playerId, teamId: 't-other' })]
                : [],
            );
          const create = vi
            .spyOn(rosterAssignmentRepository, 'create')
            .mockImplementation(async (input) =>
              makeAssignment({ ...input, id: 'a-new' }),
            );

          const act = playerService.assignPlayer(
            admin,
            { teamId, playerId, jerseyNumber: 0 },
            ex,
          );

          if (hasSameSeason) {
            // Already assigned in that Season → ConflictError, no create (Req 3.2).
            await expect(act).rejects.toBeInstanceOf(ConflictError);
            expect(create).not.toHaveBeenCalled();
          } else {
            // None in that Season → accepted (cross-Season does not block, Req 3.3).
            await expect(act).resolves.toMatchObject({ playerId, teamId });
            expect(create).toHaveBeenCalledTimes(1);
          }
          // The season guard always queried the target Team's Season.
          expect(sameSeason.mock.calls[0]!.slice(0, 2)).toEqual([
            playerId,
            seasonId,
          ]);
        },
      ),
      { numRuns: 100 },
    );
  });
});

// ---------------------------------------------------------------------------
// Property 6 (task 5.8) — unassign isolation
// ---------------------------------------------------------------------------

describe('Property 6: unassign isolation', () => {
  // Feature: player-master-data, Property 6: unassignPlayer deletes exactly the one assignment found for (playerId, teamId) and nothing else; when none exists it throws NotFoundError and deletes nothing. (Validates Requirements 2.5)
  it('deletes exactly the found assignment; NotFound when none exists', async () => {
    await fc.assert(
      fc.asyncProperty(
        id,
        id,
        id,
        fc.boolean(),
        async (playerId, teamId, assignmentId, exists) => {
          const found = exists
            ? makeAssignment({ id: assignmentId, playerId, teamId })
            : null;
          vi.spyOn(
            rosterAssignmentRepository,
            'findByPlayerAndTeam',
          ).mockResolvedValue(found);
          const del = vi
            .spyOn(rosterAssignmentRepository, 'delete')
            .mockResolvedValue(true);

          const act = playerService.unassignPlayer(
            admin,
            { teamId, playerId },
            ex,
          );

          if (exists) {
            // Deletes exactly the one found assignment, by its id (Req 2.5).
            await expect(act).resolves.toBeUndefined();
            expect(del).toHaveBeenCalledTimes(1);
            expect(del.mock.calls[0]![0]).toBe(assignmentId);
          } else {
            // No such assignment → NotFoundError and no delete (Req 2.5/2.6).
            await expect(act).rejects.toBeInstanceOf(NotFoundError);
            expect(del).not.toHaveBeenCalled();
          }
        },
      ),
      { numRuns: 100 },
    );
  });
});

// ---------------------------------------------------------------------------
// Property 7 (task 5.9) — authorization non-disclosure
// ---------------------------------------------------------------------------

describe('Property 7: authorization non-disclosure', () => {
  // Feature: player-master-data, Property 7: a Team_Manager acting on an unmanaged Team, or any Viewer, is denied every team-scoped mutation with AuthorizationError before any repository read or write occurs (no repo method is ever called). (Validates Requirements 2.2, 2.3, 3.6, 9.2)
  it('denies unauthorized team-scoped mutations with no repo access', async () => {
    await fc.assert(
      fc.asyncProperty(
        id,
        id,
        id,
        jersey,
        fc.boolean(),
        async (teamId, otherTeamId, playerId, jerseyNumber, isManager) => {
          fc.pre(teamId !== otherTeamId);

          // Either a Team_Manager who manages a *different* Team, or a Viewer.
          const user = isManager ? manager(otherTeamId) : viewer;

          // Spy every repository method the three team-scoped mutations could
          // reach. None must be called — authorization runs first (Req 3.6/9.2).
          const spies = [
            vi.spyOn(teamRepository, 'findById'),
            vi.spyOn(playerRepository, 'findById'),
            vi.spyOn(rosterAssignmentRepository, 'listByTeam'),
            vi.spyOn(rosterAssignmentRepository, 'listByPlayerInSeason'),
            vi.spyOn(rosterAssignmentRepository, 'findByPlayerAndTeam'),
            vi.spyOn(rosterAssignmentRepository, 'create'),
            vi.spyOn(rosterAssignmentRepository, 'updateJersey'),
            vi.spyOn(rosterAssignmentRepository, 'delete'),
          ];

          await expect(
            playerService.assignPlayer(
              user,
              { teamId, playerId, jerseyNumber },
              ex,
            ),
          ).rejects.toBeInstanceOf(AuthorizationError);

          await expect(
            playerService.unassignPlayer(user, { teamId, playerId }, ex),
          ).rejects.toBeInstanceOf(AuthorizationError);

          await expect(
            playerService.updateAssignmentJersey(
              user,
              { teamId, playerId, jerseyNumber },
              ex,
            ),
          ).rejects.toBeInstanceOf(AuthorizationError);

          // No read and no write ever happened (non-disclosure, Req 2.2/2.3/3.6/9.2).
          for (const spy of spies) {
            expect(spy).not.toHaveBeenCalled();
          }
        },
      ),
      { numRuns: 100 },
    );
  });
});

// ---------------------------------------------------------------------------
// Property 8 (task 5.11) — roster read shape (including empty)
// ---------------------------------------------------------------------------

describe('Property 8: roster read shape (including empty)', () => {
  // Feature: player-master-data, Property 8: getTeamRoster returns one { playerId, name, jerseyNumber } entry per Team assignment, resolving each master name, and an empty roster yields [] with no error. (Validates Requirements 4.1, 4.2)
  it('maps each assignment to { playerId, name, jerseyNumber }; empty → []', async () => {
    await fc.assert(
      fc.asyncProperty(
        id,
        fc.array(
          fc.record({ playerId: id, name: validName, jerseyNumber: jersey }),
          { maxLength: 6 },
        ),
        async (teamId, people) => {
          const assignments: RosterAssignment[] = people.map((p, i) =>
            makeAssignment({
              id: `a-${i}`,
              playerId: p.playerId,
              teamId,
              jerseyNumber: p.jerseyNumber,
            }),
          );
          const nameByPlayer = new Map(people.map((p) => [p.playerId, p.name]));

          vi.spyOn(rosterAssignmentRepository, 'listByTeam').mockResolvedValue(
            assignments,
          );
          vi.spyOn(playerRepository, 'findById').mockImplementation(
            async (pid) => {
              const name = nameByPlayer.get(pid);
              return name === undefined ? null : makePlayer({ id: pid, name });
            },
          );

          const roster = await playerService.getTeamRoster(teamId, ex);

          // Empty Team yields an empty array with no error (Req 4.2).
          expect(roster).toHaveLength(assignments.length);
          roster.forEach((entry, i) => {
            // Exactly the roster-entry shape (Req 4.1).
            expect(Object.keys(entry).sort()).toEqual([
              'jerseyNumber',
              'name',
              'playerId',
            ]);
            const a = assignments[i]!;
            expect(entry.playerId).toBe(a.playerId);
            expect(entry.jerseyNumber).toBe(a.jerseyNumber);
            expect(entry.name).toBe(nameByPlayer.get(a.playerId));
          });
        },
      ),
      { numRuns: 100 },
    );
  });
});

// ---------------------------------------------------------------------------
// Property 9 (task 5.11) — player history shape
// ---------------------------------------------------------------------------

describe('Property 9: player history shape', () => {
  // Feature: player-master-data, Property 9: getPlayerHistory returns one { assignmentId, teamId, seasonId, jerseyNumber } entry per Player assignment, resolving each Team's Season. (Validates Requirements 4.3)
  it('maps each assignment to { assignmentId, teamId, seasonId, jerseyNumber }', async () => {
    await fc.assert(
      fc.asyncProperty(
        id,
        fc.array(
          fc.record({
            assignmentId: id,
            teamId: id,
            seasonId: id,
            jerseyNumber: jersey,
          }),
          { maxLength: 6 },
        ),
        async (playerId, entries) => {
          const assignments: RosterAssignment[] = entries.map((e) =>
            makeAssignment({
              id: e.assignmentId,
              playerId,
              teamId: e.teamId,
              jerseyNumber: e.jerseyNumber,
            }),
          );
          const seasonByTeam = new Map(entries.map((e) => [e.teamId, e.seasonId]));

          vi.spyOn(rosterAssignmentRepository, 'listByPlayer').mockResolvedValue(
            assignments,
          );
          vi.spyOn(teamRepository, 'findById').mockImplementation(
            async (tid) => {
              const seasonId = seasonByTeam.get(tid);
              return seasonId === undefined
                ? null
                : makeTeam({ id: tid, seasonId });
            },
          );

          const history = await playerService.getPlayerHistory(playerId, ex);

          expect(history).toHaveLength(assignments.length);
          history.forEach((entry, i) => {
            // Exactly the history-entry shape (Req 4.3).
            expect(Object.keys(entry).sort()).toEqual([
              'assignmentId',
              'jerseyNumber',
              'seasonId',
              'teamId',
            ]);
            const a = assignments[i]!;
            expect(entry.assignmentId).toBe(a.id);
            expect(entry.teamId).toBe(a.teamId);
            expect(entry.jerseyNumber).toBe(a.jerseyNumber);
            expect(entry.seasonId).toBe(seasonByTeam.get(a.teamId));
          });
        },
      ),
      { numRuns: 100 },
    );
  });
});
