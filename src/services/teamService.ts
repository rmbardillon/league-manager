/**
 * TeamService — application service for Team management (Requirement 3).
 *
 * Orchestrates the {@link teamRepository} and {@link seasonRepository} to
 * create, update, and delete Teams while enforcing the business rules that the
 * data-access layer intentionally omits:
 *
 *   - Name length between 1 and 100 characters (Req 3.2 / 3.5).
 *   - The target Season must exist (Req 3.3).
 *   - No case-insensitive duplicate Team name within the same Season
 *     (Req 3.4 / 3.5).
 *   - A Team may be updated only if it exists (Req 3.6).
 *   - A Team may be deleted only when it has zero completed Games; a Team with
 *     one or more completed Games is retained unchanged (Req 3.7 / 3.8).
 *
 * Read-then-write use cases (the duplicate-name check followed by the insert /
 * update, and the completed-Games check followed by the delete) run inside a
 * single {@link withTransaction} unit so the guard and the mutation are atomic
 * and a rejected operation leaves the target data unchanged.
 *
 * Failures are expressed with the shared error taxonomy so the API layer can
 * map them to the correct HTTP status.
 *
 * _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5, 3.6, 3.7, 3.8_
 */
import { db } from '../db/client.js';
import {
  ConflictError,
  ConstraintError,
  NotFoundError,
  ValidationError,
} from '../domain/errors.js';
import type { Team } from '../domain/types.js';
import {
  seasonRepository,
  teamRepository,
  withTransaction,
  type Executor,
} from '../repositories/index.js';

/** Command to create a Team within a Season (Req 3.1). */
export interface CreateTeamInput {
  seasonId: string;
  name: string;
}

/** Command to update an existing Team's mutable details (Req 3.5). */
export interface UpdateTeamInput {
  name: string;
}

const NAME_MIN_LENGTH = 1;
const NAME_MAX_LENGTH = 100;

/**
 * Validate a Team name against the 1–100 character bound (Req 3.2 / 3.5).
 * The stored/compared name is the trimmed value.
 *
 * @throws {ValidationError} when the trimmed name is empty or too long.
 */
function normalizeName(name: string): string {
  const trimmed = name.trim();
  if (trimmed.length < NAME_MIN_LENGTH || trimmed.length > NAME_MAX_LENGTH) {
    throw new ValidationError(
      `Team name must be between ${NAME_MIN_LENGTH} and ${NAME_MAX_LENGTH} characters.`,
      { field: 'name' },
    );
  }
  return trimmed;
}

/**
 * Reject when another Team in the same Season already uses `name`
 * (case-insensitive). `excludeTeamId`, when provided, is skipped so a Team can
 * keep its own name on update (Req 3.4 / 3.5).
 *
 * @throws {ConflictError} on a case-insensitive duplicate.
 */
async function assertNameAvailable(
  seasonId: string,
  name: string,
  ex: Executor,
  excludeTeamId?: string,
): Promise<void> {
  const target = name.toLowerCase();
  const existing = await teamRepository.listBySeason(seasonId, ex);
  const duplicate = existing.some(
    (team) => team.id !== excludeTeamId && team.name.toLowerCase() === target,
  );
  if (duplicate) {
    throw new ConflictError(
      'A Team with that name already exists in this Season.',
      { field: 'name' },
    );
  }
}

export const teamService = {
  /**
   * Create a Team and associate it with the given Season (Req 3.1).
   *
   * Rejects when the name length is outside 1–100 (Req 3.2), the Season does
   * not exist (Req 3.3), or a case-insensitive duplicate name exists in the
   * Season (Req 3.4). No Team is created on any failure.
   */
  async createTeam(input: CreateTeamInput): Promise<Team> {
    const name = normalizeName(input.name);
    return withTransaction(db, async (tx) => {
      const season = await seasonRepository.findById(input.seasonId, tx);
      if (!season) {
        throw new NotFoundError('Season was not found.', {
          field: 'seasonId',
          seasonId: input.seasonId,
        });
      }
      await assertNameAvailable(input.seasonId, name, tx);
      return teamRepository.create({ seasonId: input.seasonId, name }, tx);
    });
  },

  /**
   * Update an existing Team's details (Req 3.5).
   *
   * Rejects when the Team does not exist (Req 3.6), the name length is outside
   * 1–100 (Req 3.2), or the new name duplicates another Team in the same
   * Season case-insensitively (Req 3.4). Existing records are preserved
   * unchanged on any failure.
   */
  async updateTeam(teamId: string, input: UpdateTeamInput): Promise<Team> {
    const name = normalizeName(input.name);
    return withTransaction(db, async (tx) => {
      const existing = await teamRepository.findById(teamId, tx);
      if (!existing) {
        throw new NotFoundError('Team was not found.', { field: 'teamId', teamId });
      }
      await assertNameAvailable(existing.seasonId, name, tx, teamId);
      const updated = await teamRepository.update(teamId, { name }, tx);
      if (!updated) {
        // The row existed at read time; a null here means it vanished mid-txn.
        throw new NotFoundError('Team was not found.', { field: 'teamId', teamId });
      }
      return updated;
    });
  },

  /**
   * Delete a Team that has zero completed Games (Req 3.7).
   *
   * Rejects when the Team does not exist (Req 3.6) or has one or more completed
   * Games (Req 3.8); in the latter case the Team and its associated records are
   * retained unchanged.
   */
  async deleteTeam(teamId: string): Promise<void> {
    return withTransaction(db, async (tx) => {
      const existing = await teamRepository.findById(teamId, tx);
      if (!existing) {
        throw new NotFoundError('Team was not found.', { field: 'teamId', teamId });
      }
      const completedGames = await teamRepository.countCompletedGames(teamId, tx);
      if (completedGames > 0) {
        throw new ConstraintError(
          'Team has one or more completed Games and cannot be deleted.',
          { field: 'teamId', teamId, completedGames },
        );
      }
      await teamRepository.delete(teamId, tx);
    });
  },
};
