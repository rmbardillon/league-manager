/**
 * PlayerService / RosterService (Requirement 4).
 *
 * Orchestrates the roster use cases — add, update, and remove a Player on a
 * Team — coordinating team-scoped authorization, field validation, jersey
 * uniqueness within the roster, and persistence through the repository layer.
 *
 * Design placement (Components and Interfaces → PlayerService / RosterService):
 * this is an application service. It contains no HTTP concerns and no data
 * access of its own; it validates, delegates authorization to the pure
 * `authorize` domain function, and reads/writes through `playerRepository`.
 *
 * Every method:
 *   - Enforces team-scoped authorization first, so an unauthorized caller
 *     never learns whether the target Player exists and the roster is left
 *     unchanged (Req 4.4).
 *   - Validates field bounds (name 1–100 chars, jersey 0–99) before any write
 *     (Req 4.3).
 *   - Rejects a duplicate jersey number within the same Team's roster
 *     (Req 4.2, 4.7).
 *   - Rejects a missing target Player on update/remove (Req 4.6).
 * A rejected operation throws a typed {@link DomainError} and performs no
 * write, leaving the roster unchanged.
 *
 * _Requirements: 4.1, 4.2, 4.3, 4.5, 4.6, 4.7_
 */

import { authorize, type AuthUser } from '../domain/authorize.js';
import {
  AuthorizationError,
  ConflictError,
  NotFoundError,
  ValidationError,
} from '../domain/errors.js';
import type { Player } from '../domain/types.js';
import { playerRepository } from '../repositories/index.js';
import type { Executor } from '../repositories/index.js';

// ---------------------------------------------------------------------------
// Validation bounds (Requirement 4)
// ---------------------------------------------------------------------------

/** Inclusive minimum Player name length (Req 4.1, 4.3). */
const NAME_MIN_LENGTH = 1;
/** Inclusive maximum Player name length (Req 4.1, 4.3). */
const NAME_MAX_LENGTH = 100;
/** Inclusive minimum jersey number (Req 4.1, 4.3). */
const JERSEY_MIN = 0;
/** Inclusive maximum jersey number (Req 4.1, 4.3). */
const JERSEY_MAX = 99;

// ---------------------------------------------------------------------------
// Command shapes
// ---------------------------------------------------------------------------

/** Command to add a Player to a Team's roster (Req 4.1). */
export interface AddPlayerCommand {
  readonly teamId: string;
  readonly name: string;
  readonly jerseyNumber: number;
}

/**
 * Command to update an existing Player's name and/or jersey number (Req 4.7).
 * Omitted fields are left unchanged; at least one field is expected.
 */
export interface UpdatePlayerCommand {
  readonly playerId: string;
  readonly name?: string;
  readonly jerseyNumber?: number;
}

/** Command to remove a Player from a Team's roster (Req 4.5). */
export interface RemovePlayerCommand {
  readonly playerId: string;
}

// ---------------------------------------------------------------------------
// Field validation helpers
// ---------------------------------------------------------------------------

/**
 * Validate the Player name length (Req 4.3). Throws {@link ValidationError}
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
 * Validate the jersey number range (Req 4.3). A jersey number must be an
 * integer within 0–99. Throws {@link ValidationError} naming the field when
 * out of bounds or non-integer.
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

/**
 * Reject a jersey number already used by another Player on the same Team's
 * roster (Req 4.2, 4.7). `excludePlayerId` is the Player being updated, so an
 * unchanged Player does not collide with itself.
 */
function assertJerseyAvailable(
  roster: readonly Player[],
  jerseyNumber: number,
  excludePlayerId: string | null,
): void {
  const clash = roster.some(
    (p) => p.jerseyNumber === jerseyNumber && p.id !== excludePlayerId,
  );
  if (clash) {
    throw new ConflictError(
      `Jersey number ${jerseyNumber} is already used by another Player on this Team.`,
      { field: 'jerseyNumber', jerseyNumber },
    );
  }
}

/**
 * Enforce team-scoped authorization for a roster mutation (Req 4.4). Throws
 * {@link AuthorizationError} when the caller may not act on the Team, so no
 * read or write of the roster occurs.
 */
function assertAuthorized(
  user: AuthUser,
  teamId: string,
  action: 'create' | 'update' | 'delete',
): void {
  const decision = authorize(user, action, { kind: 'team', teamId });
  if (!decision.allowed) {
    throw new AuthorizationError(decision.reason);
  }
}

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

/**
 * The roster application service. Each method receives the acting
 * {@link AuthUser} and an {@link Executor} (the root `db` handle or a
 * transaction), mirroring the repository contract so calls compose inside a
 * larger transaction when needed.
 */
export const playerService = {
  /**
   * Add a Player to a Team's roster (Req 4.1).
   *
   * Order of checks: authorization (Req 4.4) → field validation (Req 4.3) →
   * jersey uniqueness within the roster (Req 4.2). On success the Player is
   * persisted and returned.
   */
  async addPlayer(
    user: AuthUser,
    command: AddPlayerCommand,
    ex: Executor,
  ): Promise<Player> {
    assertAuthorized(user, command.teamId, 'create');
    validateName(command.name);
    validateJerseyNumber(command.jerseyNumber);

    const roster = await playerRepository.listByTeam(command.teamId, ex);
    assertJerseyAvailable(roster, command.jerseyNumber, null);

    return playerRepository.create(
      {
        teamId: command.teamId,
        name: command.name,
        jerseyNumber: command.jerseyNumber,
      },
      ex,
    );
  },

  /**
   * Update an existing Player's name and/or jersey number (Req 4.7).
   *
   * Order of checks: the Player must exist (Req 4.6), then the acting user
   * must be authorized for that Player's Team (Req 4.4), then the supplied
   * fields must pass the validation bounds (Req 4.3), then the jersey number
   * must not duplicate another Player on the same roster — the Player being
   * updated is excluded from the check (Req 4.7). On success the updated
   * Player is persisted and returned.
   */
  async updatePlayer(
    user: AuthUser,
    command: UpdatePlayerCommand,
    ex: Executor,
  ): Promise<Player> {
    const existing = await playerRepository.findById(command.playerId, ex);
    if (existing === null) {
      throw new NotFoundError('Player not found.', {
        playerId: command.playerId,
      });
    }

    assertAuthorized(user, existing.teamId, 'update');

    const nextName = command.name ?? existing.name;
    const nextJersey = command.jerseyNumber ?? existing.jerseyNumber;

    if (command.name !== undefined) {
      validateName(command.name);
    }
    if (command.jerseyNumber !== undefined) {
      validateJerseyNumber(command.jerseyNumber);

      const roster = await playerRepository.listByTeam(existing.teamId, ex);
      assertJerseyAvailable(roster, command.jerseyNumber, existing.id);
    }

    const updated = await playerRepository.update(
      command.playerId,
      { name: nextName, jerseyNumber: nextJersey },
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
   * Remove a Player from a Team's roster (Req 4.5).
   *
   * Order of checks: the Player must exist (Req 4.6), then the acting user
   * must be authorized for that Player's Team (Req 4.4). On success the Player
   * is removed from the roster.
   */
  async removePlayer(
    user: AuthUser,
    command: RemovePlayerCommand,
    ex: Executor,
  ): Promise<void> {
    const existing = await playerRepository.findById(command.playerId, ex);
    if (existing === null) {
      throw new NotFoundError('Player not found.', {
        playerId: command.playerId,
      });
    }

    assertAuthorized(user, existing.teamId, 'delete');

    const removed = await playerRepository.delete(command.playerId, ex);
    if (!removed) {
      throw new NotFoundError('Player not found.', {
        playerId: command.playerId,
      });
    }
  },
};

/** The roster application service type (for dependency-injection typing). */
export type PlayerService = typeof playerService;
