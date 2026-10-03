/**
 * PlayerService — application service for the master Player and roster model
 * (Requirement 1, plus the assignment/read use cases of Requirements 2–4).
 *
 * The Player model is split into two concerns, and so is this service:
 *
 *   - **Master Player methods** (`createPlayer`, `getPlayer`, `listPlayers`,
 *     `updatePlayer`, `removePlayer`) operate on the master `Player`
 *     `{ id, name }` — a person, decoupled from any Team or jersey. These are
 *     Administrator-scoped operations (they are not team-scoped), so they
 *     authorize via the pure `authorize(user, action, { kind: 'admin' })`
 *     decision (Requirement 1).
 *   - **Assignment methods** (`assignPlayer`, `unassignPlayer`,
 *     `updateAssignmentJersey`) and the **roster/history reads**
 *     (`getTeamRoster`, `getPlayerHistory`) operate on `roster_assignments` —
 *     the Team membership and jersey that used to live on `players`. These are
 *     team-scoped (Requirements 2–4) and are added to this file by the later
 *     tasks (5.5 / 5.10); their place is marked below.
 *
 * Design placement (Components and Interfaces → `playerService` reworked): this
 * is an application service. It holds no HTTP concerns and performs no data
 * access of its own; it validates, delegates authorization to the pure
 * `authorize` domain function, and reads/writes through `playerRepository` and
 * `rosterAssignmentRepository`.
 *
 * Every method follows the same discipline: authorize first (an unauthorized
 * caller never learns whether the target exists and nothing is written), then
 * validate field bounds, then check conflicts, then write. A rejected
 * operation throws a typed {@link DomainError} and performs no write.
 *
 * _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5, 1.6, 1.7, 1.8, 1.9_
 */

import { db } from '../db/client.js';
import { authorize, type Action, type AuthUser } from '../domain/authorize.js';
import {
  AuthorizationError,
  ConflictError,
  NotFoundError,
  ValidationError,
} from '../domain/errors.js';
import type {
  Player,
  PlayerHistoryEntry,
  RosterAssignment,
  RosterEntry,
} from '../domain/types.js';
import {
  playerRepository,
  rosterAssignmentRepository,
  teamRepository,
  withTransaction,
  type Executor,
} from '../repositories/index.js';

// ---------------------------------------------------------------------------
// Validation bounds (Requirement 1)
// ---------------------------------------------------------------------------

/** Inclusive minimum Player name length (Req 1.2). */
const NAME_MIN_LENGTH = 1;
/** Inclusive maximum Player name length (Req 1.2). */
const NAME_MAX_LENGTH = 100;

/** Inclusive minimum jersey number for a roster assignment (Req 2.4). */
const JERSEY_MIN = 0;
/** Inclusive maximum jersey number for a roster assignment (Req 2.4). */
const JERSEY_MAX = 99;

// ---------------------------------------------------------------------------
// Command shapes
// ---------------------------------------------------------------------------

/** Command to create a master Player (Req 1.1). */
export interface CreatePlayerCommand {
  readonly name: string;
}

/** Command addressing a single master Player by id (Req 1.4, 1.5, 1.8, 1.9). */
export interface PlayerIdCommand {
  readonly playerId: string;
}

/** Command to rename an existing master Player (Req 1.6). */
export interface UpdatePlayerCommand {
  readonly playerId: string;
  readonly name: string;
}

/**
 * Command to assign a master Player to a Team with a jersey number (Req 2.1).
 * Team-scoped: authorization is decided against `teamId`.
 */
export interface AssignPlayerCommand {
  readonly teamId: string;
  readonly playerId: string;
  readonly jerseyNumber: number;
}

/**
 * Command to remove a Player's assignment on a specific Team (Req 2.5, 2.6).
 * Team-scoped: authorization is decided against `teamId`.
 */
export interface UnassignPlayerCommand {
  readonly teamId: string;
  readonly playerId: string;
}

/**
 * Command to change the jersey number of an existing assignment (Req 2.7).
 * Team-scoped: authorization is decided against `teamId`.
 */
export interface UpdateAssignmentJerseyCommand {
  readonly teamId: string;
  readonly playerId: string;
  readonly jerseyNumber: number;
}

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

/**
 * Enforce Administrator-scoped authorization for a master Player operation
 * (Req 1). These operations are not team-scoped, so the resource is
 * `{ kind: 'admin' }`. Throws {@link AuthorizationError} when the caller may
 * not act, so no read or write occurs.
 */
function assertAdmin(user: AuthUser, action: Action): void {
  const decision = authorize(user, action, { kind: 'admin' });
  if (!decision.allowed) {
    throw new AuthorizationError(decision.reason);
  }
}

/**
 * Enforce team-scoped authorization for a roster-assignment operation
 * (Req 2.2, 2.3, 3.6, 9.2). The resource is `{ kind: 'team', teamId }`, so a
 * Team_Manager is allowed only on a Team in their managed set and every other
 * non-admin caller is denied. Throws {@link AuthorizationError} when the caller
 * may not act — and because this is called *first*, before any read, an
 * unauthorized caller never learns whether the Team, Player, or assignment
 * exists (non-disclosure, Req 2.3/3.6/9.2).
 */
function assertTeamAuthorized(
  user: AuthUser,
  teamId: string,
  action: Action,
): void {
  const decision = authorize(user, action, { kind: 'team', teamId });
  if (!decision.allowed) {
    throw new AuthorizationError(decision.reason);
  }
}

/**
 * Validate the Player name length (Req 1.2). Throws {@link ValidationError}
 * naming the offending field when out of bounds.
 */
function validateName(name: string): void {
  if (name.length < NAME_MIN_LENGTH || name.length > NAME_MAX_LENGTH) {
    throw new ValidationError(
      `Player name must be between ${NAME_MIN_LENGTH} and ${NAME_MAX_LENGTH} characters.`,
      { field: 'name' },
    );
  }
}

/**
 * Validate a jersey number: an integer within 0–99 inclusive (Req 2.4). Throws
 * {@link ValidationError} naming the `jerseyNumber` field when the value is not
 * an integer or is out of range.
 */
function validateJerseyNumber(jerseyNumber: number): void {
  if (
    !Number.isInteger(jerseyNumber) ||
    jerseyNumber < JERSEY_MIN ||
    jerseyNumber > JERSEY_MAX
  ) {
    throw new ValidationError(
      `Jersey number must be an integer between ${JERSEY_MIN} and ${JERSEY_MAX}.`,
      { field: 'jerseyNumber' },
    );
  }
}

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

/**
 * The Player application service. Each method receives the acting
 * {@link AuthUser} and an {@link Executor} (the root `db` handle or a
 * transaction), mirroring the repository contract so calls compose inside a
 * larger transaction when needed.
 */
export const playerService = {
  // -------------------------------------------------------------------------
  // Master Player methods (Administrator-scoped — Requirement 1)
  // -------------------------------------------------------------------------

  /**
   * Create a master Player (Req 1.1).
   *
   * Order of checks: Administrator authorization (Req 1) → name validation
   * 1–100 chars (Req 1.2). Duplicate names are allowed — there is no
   * uniqueness check (Req 1.3). On success the master Player `{ id, name }` is
   * persisted and returned.
   */
  async createPlayer(
    user: AuthUser,
    command: CreatePlayerCommand,
    ex: Executor,
  ): Promise<Player> {
    assertAdmin(user, 'create');
    validateName(command.name);
    return playerRepository.create({ name: command.name }, ex);
  },

  /**
   * Fetch a master Player by id (Req 1.4).
   *
   * Authorizes as an Administrator, then reads the Player. Throws
   * {@link NotFoundError} when no Player has that id (Req 1.5).
   */
  async getPlayer(
    user: AuthUser,
    command: PlayerIdCommand,
    ex: Executor,
  ): Promise<Player> {
    assertAdmin(user, 'update');
    const player = await playerRepository.findById(command.playerId, ex);
    if (player === null) {
      throw new NotFoundError('Player not found.', {
        playerId: command.playerId,
      });
    }
    return player;
  },

  /**
   * List every master Player (Req 1.7).
   *
   * Authorizes as an Administrator, then returns all masters.
   */
  async listPlayers(user: AuthUser, ex: Executor): Promise<Player[]> {
    assertAdmin(user, 'update');
    return playerRepository.list(ex);
  },

  /**
   * Rename an existing master Player (Req 1.6).
   *
   * Order of checks: Administrator authorization (Req 1) → the Player must
   * exist (Req 1.5) → name validation 1–100 chars (Req 1.2). Only the master
   * Player's name is changed; its roster assignments are untouched (Req 1.6).
   * On success the updated master Player is returned.
   */
  async updatePlayer(
    user: AuthUser,
    command: UpdatePlayerCommand,
    ex: Executor,
  ): Promise<Player> {
    assertAdmin(user, 'update');
    const existing = await playerRepository.findById(command.playerId, ex);
    if (existing === null) {
      throw new NotFoundError('Player not found.', {
        playerId: command.playerId,
      });
    }
    validateName(command.name);
    const updated = await playerRepository.update(
      command.playerId,
      { name: command.name },
      ex,
    );
    // The Player existed and is authorized/validated above; a null here would
    // mean it was removed concurrently between the read and the write.
    if (updated === null) {
      throw new NotFoundError('Player not found.', {
        playerId: command.playerId,
      });
    }
    return updated;
  },

  /**
   * Remove a master Player (Req 1.9).
   *
   * Order of checks: Administrator authorization (Req 1) → the Player must
   * exist (Req 1.5) → the Player must hold no roster assignments (Req 1.8). A
   * Player still assigned to one or more Teams is retained and a
   * {@link ConflictError} is thrown. The exist-check, assignment count, and
   * delete run inside a single {@link withTransaction} unit so the
   * count-then-delete is consistent; the database `onDelete: 'restrict'` FK on
   * `roster_assignments.player_id` is the backstop.
   */
  async removePlayer(
    user: AuthUser,
    command: PlayerIdCommand,
    ex: Executor,
  ): Promise<void> {
    assertAdmin(user, 'delete');
    // The count-then-delete must be atomic. `withTransaction` opens a single
    // transaction on the root database handle (mirroring `teamService`); the
    // `ex` passed in is accepted for signature uniformity with the other
    // methods but the atomic unit is this transaction.
    void ex;
    await withTransaction(db, async (tx) => {
      const existing = await playerRepository.findById(command.playerId, tx);
      if (existing === null) {
        throw new NotFoundError('Player not found.', {
          playerId: command.playerId,
        });
      }

      const assignments = await rosterAssignmentRepository.listByPlayer(
        command.playerId,
        tx,
      );
      if (assignments.length > 0) {
        throw new ConflictError(
          'Player is still assigned to one or more Teams.',
          { playerId: command.playerId, assignments: assignments.length },
        );
      }

      await playerRepository.delete(command.playerId, tx);
    });
  },

  // -------------------------------------------------------------------------
  // Assignment methods (team-scoped — Requirements 2, 3)
  //
  // These operate on `roster_assignments` via `rosterAssignmentRepository`
  // and authorize via `authorize(user, action, { kind: 'team', teamId })`.
  // Roster & player-history reads (Requirement 4) are added by task 5.10.
  // -------------------------------------------------------------------------

  /**
   * Assign a master Player to a Team with a jersey number (Req 2.1).
   *
   * Order of checks (team-scoped):
   *   1. Authorize on `teamId` **first**, before any read, so an unauthorized
   *      caller never learns whether the Team or Player exists (Req 2.2, 2.3,
   *      3.6).
   *   2. Validate the jersey number is an integer 0–99 (Req 2.4).
   *   3. Inside a single {@link withTransaction} unit (mirroring
   *      `removePlayer`): the Team must exist → {@link NotFoundError}(Team)
   *      (Req 3.5); the Player must exist → {@link NotFoundError}(Player)
   *      (Req 3.4).
   *   4. Jersey uniqueness within the Team roster: no existing assignment on
   *      the Team may already use `jerseyNumber` → {@link ConflictError}
   *      (Req 3.1).
   *   5. One assignment per Player per Season: resolve the Team's `seasonId`
   *      and require the Player to hold no assignment in that Season →
   *      {@link ConflictError} (Req 3.2). An assignment in a *different* Season
   *      does not block this one (Req 3.3).
   *   6. Create the assignment and return it (Req 2.1).
   *
   * The guard reads and the create run in one transaction so the
   * check-then-write is consistent; the DB `unique(team_id, jersey_number)` on
   * `roster_assignments` is the backstop for the jersey rule.
   */
  async assignPlayer(
    user: AuthUser,
    command: AssignPlayerCommand,
    ex: Executor,
  ): Promise<RosterAssignment> {
    // 1. Authorize first — no reads before this point (non-disclosure).
    assertTeamAuthorized(user, command.teamId, 'create');
    // 2. Field validation.
    validateJerseyNumber(command.jerseyNumber);

    // 3–6 run atomically. The `ex` passed in is accepted for signature
    // uniformity with the other methods; the atomic unit is this transaction.
    void ex;
    return withTransaction(db, async (tx) => {
      // 3. Existence checks: Team (Req 3.5), then Player (Req 3.4).
      const team = await teamRepository.findById(command.teamId, tx);
      if (team === null) {
        throw new NotFoundError('Team not found.', { teamId: command.teamId });
      }

      const player = await playerRepository.findById(command.playerId, tx);
      if (player === null) {
        throw new NotFoundError('Player not found.', {
          playerId: command.playerId,
        });
      }

      // 4. Jersey uniqueness within the Team roster (Req 3.1).
      const roster = await rosterAssignmentRepository.listByTeam(
        command.teamId,
        tx,
      );
      if (roster.some((a) => a.jerseyNumber === command.jerseyNumber)) {
        throw new ConflictError(
          'Jersey number is already in use on this Team.',
          { teamId: command.teamId, jerseyNumber: command.jerseyNumber },
        );
      }

      // 5. One assignment per Player per Season (Req 3.2); a different-Season
      // assignment passes (Req 3.3).
      const sameSeason = await rosterAssignmentRepository.listByPlayerInSeason(
        command.playerId,
        team.seasonId,
        tx,
      );
      if (sameSeason.length > 0) {
        throw new ConflictError(
          'Player is already assigned to a Team in that Season.',
          { playerId: command.playerId, seasonId: team.seasonId },
        );
      }

      // 6. Create and return the assignment (Req 2.1).
      return rosterAssignmentRepository.create(
        {
          playerId: command.playerId,
          teamId: command.teamId,
          jerseyNumber: command.jerseyNumber,
        },
        tx,
      );
    });
  },

  /**
   * Remove a Player's assignment on a specific Team (Req 2.5).
   *
   * Order of checks (team-scoped): authorize on `teamId` first (no prior
   * reads, Req 2.2/2.3), then find the assignment by `(playerId, teamId)`
   * inside a transaction. When no such assignment exists a
   * {@link NotFoundError} is thrown (Req 2.6). Otherwise only that one
   * assignment is deleted — the master Player and the Player's assignments to
   * other Teams are retained (Req 2.5).
   */
  async unassignPlayer(
    user: AuthUser,
    command: UnassignPlayerCommand,
    ex: Executor,
  ): Promise<void> {
    assertTeamAuthorized(user, command.teamId, 'delete');

    void ex;
    await withTransaction(db, async (tx) => {
      const assignment = await rosterAssignmentRepository.findByPlayerAndTeam(
        command.playerId,
        command.teamId,
        tx,
      );
      if (assignment === null) {
        throw new NotFoundError('No assignment for that Player on that Team.', {
          playerId: command.playerId,
          teamId: command.teamId,
        });
      }

      await rosterAssignmentRepository.delete(assignment.id, tx);
    });
  },

  /**
   * Change the jersey number of an existing assignment (Req 2.7).
   *
   * Order of checks (team-scoped): authorize on `teamId` first (no prior
   * reads, Req 2.2/2.3) → validate the jersey number is an integer 0–99
   * (Req 2.4) → inside a transaction, find the assignment by
   * `(playerId, teamId)` → {@link NotFoundError} if absent → the target jersey
   * must be free on the Team roster *excluding this assignment* → else
   * {@link ConflictError} (Req 3.1) → update and return (Req 2.7).
   */
  async updateAssignmentJersey(
    user: AuthUser,
    command: UpdateAssignmentJerseyCommand,
    ex: Executor,
  ): Promise<RosterAssignment> {
    assertTeamAuthorized(user, command.teamId, 'update');
    validateJerseyNumber(command.jerseyNumber);

    void ex;
    return withTransaction(db, async (tx) => {
      const assignment = await rosterAssignmentRepository.findByPlayerAndTeam(
        command.playerId,
        command.teamId,
        tx,
      );
      if (assignment === null) {
        throw new NotFoundError('No assignment for that Player on that Team.', {
          playerId: command.playerId,
          teamId: command.teamId,
        });
      }

      // Jersey must be free on the roster, excluding this very assignment so a
      // no-op re-save of the same number is allowed (Req 3.1).
      const roster = await rosterAssignmentRepository.listByTeam(
        command.teamId,
        tx,
      );
      if (
        roster.some(
          (a) =>
            a.id !== assignment.id &&
            a.jerseyNumber === command.jerseyNumber,
        )
      ) {
        throw new ConflictError(
          'Jersey number is already in use on this Team.',
          { teamId: command.teamId, jerseyNumber: command.jerseyNumber },
        );
      }

      const updated = await rosterAssignmentRepository.updateJersey(
        assignment.id,
        command.jerseyNumber,
        tx,
      );
      // The assignment existed and was read above; a null here would mean it
      // was removed concurrently between the read and the write.
      if (updated === null) {
        throw new NotFoundError('No assignment for that Player on that Team.', {
          playerId: command.playerId,
          teamId: command.teamId,
        });
      }
      return updated;
    });
  },

  // -------------------------------------------------------------------------
  // Roster & player-history reads (Requirement 4) — added by task 5.10.
  //
  // These are reads: they perform no authorization gate at the service level
  // (routes decide exposure per the design), so they take no AuthUser.
  // -------------------------------------------------------------------------

  /**
   * Read a Team's current roster (Req 4.1, 4.2).
   *
   * Lists the Team's roster assignments via
   * `rosterAssignmentRepository.listByTeam`, then resolves each assignment's
   * master Player name via `playerRepository.findById`, yielding
   * `{ playerId, name, jerseyNumber }` per assignment. A Team with no
   * assignments yields an empty array with no error (Req 4.2).
   *
   * This is a read; per the design, exposure is decided by the route, so no
   * authorization gate is applied here.
   */
  async getTeamRoster(teamId: string, ex: Executor): Promise<RosterEntry[]> {
    const assignments = await rosterAssignmentRepository.listByTeam(teamId, ex);
    return Promise.all(
      assignments.map(async (assignment): Promise<RosterEntry> => {
        const player = await playerRepository.findById(assignment.playerId, ex);
        return {
          playerId: assignment.playerId,
          name: player?.name ?? '',
          jerseyNumber: assignment.jerseyNumber,
        };
      }),
    );
  },

  /**
   * Read a Player's assignment history (Req 4.3).
   *
   * Lists the Player's roster assignments via
   * `rosterAssignmentRepository.listByPlayer`, then resolves each assignment's
   * Team to its `seasonId` via `teamRepository.findById`, yielding
   * `{ assignmentId, teamId, seasonId, jerseyNumber }` per assignment.
   *
   * This is a read; per the design, exposure is decided by the route, so no
   * authorization gate is applied here.
   */
  async getPlayerHistory(
    playerId: string,
    ex: Executor,
  ): Promise<PlayerHistoryEntry[]> {
    const assignments = await rosterAssignmentRepository.listByPlayer(
      playerId,
      ex,
    );
    return Promise.all(
      assignments.map(async (assignment): Promise<PlayerHistoryEntry> => {
        const team = await teamRepository.findById(assignment.teamId, ex);
        return {
          assignmentId: assignment.id,
          teamId: assignment.teamId,
          seasonId: team?.seasonId ?? '',
          jerseyNumber: assignment.jerseyNumber,
        };
      }),
    );
  },
};

/** The Player application service type (for dependency-injection typing). */
export type PlayerService = typeof playerService;
