/**
 * StatisticsService — Statistics tracking (Requirement 8).
 *
 * Orchestrates the Statistics use cases by validating the business rules in the
 * pure domain vocabulary (`validateStatistic`) and computing season totals via
 * the pure `aggregateStatistics` function, persisting/reading through the
 * Repository Layer. Read-then-write flows run inside a single transaction so a
 * rejected operation leaves any previously recorded Statistic unchanged.
 *
 * Responsibilities:
 * - `recordStatistic`     — store a value for one of the six Statistic_Type
 *                           values for an eligible Player in a Game. Rejects an
 *                           unsupported type (Req 8.4), a value that is
 *                           negative, non-integer, or outside 0–999 (Req 8.3),
 *                           and a Player who is not on either participating Team
 *                           (Req 8.5). A valid Statistic is stored associated
 *                           with the Player, Game, and Statistic_Type (Req 8.2).
 * - `getPlayerSeasonStats` — per-Statistic_Type season total for a Player,
 *                           summing the Player's recorded values of that type
 *                           across the Season, reporting zero for absent types
 *                           (Req 8.6, 8.7).
 * - `getTeamSeasonStats`  — per-Statistic_Type season total for a Team,
 *                           summing across all Players on that Team for the
 *                           Season (Req 8.8), reporting zero for absent types.
 *
 * The six-type enum, value bounds, eligibility check, and the summation are all
 * defined by the pure domain module in src/domain/statistics.ts.
 *
 * _Requirements: 8.2, 8.3, 8.4, 8.5, 8.6, 8.7, 8.8_
 */
import {
  aggregateStatistics,
  validateStatistic,
  zeroTotals,
  type EligibilityContext,
  type RosterContext,
  type StatisticTotals,
} from '../domain/statistics.js';
import { NotFoundError, ValidationError } from '../domain/errors.js';
import type { Statistic, StatisticType } from '../domain/types.js';
import type { Database } from '../repositories/executor.js';
import { withTransaction } from '../repositories/executor.js';
import {
  gameRepository,
  playerRepository,
  rosterAssignmentRepository,
  statisticRepository,
  teamRepository,
  type Executor,
} from '../repositories/index.js';
import type { Game } from '../domain/types.js';

// ---------------------------------------------------------------------------
// Command shapes
// ---------------------------------------------------------------------------

/** Input for {@link StatisticsService.recordStatistic}. */
export interface RecordStatisticCommand {
  /** The Player the Statistic is recorded for. */
  playerId: string;
  /** The Game the Statistic was recorded in. */
  gameId: string;
  /** One of the six Statistic_Type values (Req 8.1, 8.4). */
  type: StatisticType;
  /** Non-negative integer within 0–999 (Req 8.3). */
  value: number;
}

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

/**
 * Application service for Statistics tracking. Construct it with a
 * {@link Database} handle; each method opens its own transaction so the
 * validate-then-persist and multi-read flows are atomic and non-mutating on
 * failure.
 */
export class StatisticsService {
  constructor(private readonly db: Database) {}

  /**
   * Record a Statistic value for a Player in a Game (Req 8.2).
   *
   * Validation is delegated to the pure {@link validateStatistic}: the type
   * must be one of the six supported values (Req 8.4), the value must be a
   * non-negative integer within 0–999 (Req 8.3), and the Player must be on one
   * of the two participating Teams of the Game (Req 8.5). A rejected request
   * throws a typed error and stores nothing, so any previously recorded
   * Statistic is retained.
   *
   * @throws NotFoundError   if the Game does not exist.
   * @throws ValidationError if the type is unsupported, the value is invalid,
   *   or the Player is not eligible for the Game.
   */
  async recordStatistic(cmd: RecordStatisticCommand): Promise<Statistic> {
    return withTransaction(this.db, async (tx) => {
      const game = await gameRepository.findById(cmd.gameId, tx);
      if (!game) {
        throw new NotFoundError('The specified Game does not exist.', {
          gameId: cmd.gameId,
        });
      }

      // Build the eligibility context from the two participating Teams'
      // rosters so the pure validator can decide whether the Player is on
      // either Team (Req 8.5).
      const context = await this.buildEligibilityContext(game, tx);

      const candidate: Statistic = {
        id: '',
        playerId: cmd.playerId,
        gameId: cmd.gameId,
        type: cmd.type,
        value: cmd.value,
      };

      const result = validateStatistic(candidate, context);
      if (!result.valid) {
        throw this.rejectionToError(result.reason, cmd);
      }

      // Req 8.2: store the value associated with the Player, Game, and type.
      // Upsert keyed on (player, game, type) so a corrected value replaces the
      // prior one for the same triple rather than duplicating it.
      return statisticRepository.upsert(
        {
          playerId: cmd.playerId,
          gameId: cmd.gameId,
          type: cmd.type,
          value: cmd.value,
        },
        tx,
      );
    });
  }

  /**
   * Season total for each of the six Statistic_Type values for a single Player
   * (Req 8.6). Each total is the sum of that Player's recorded values of that
   * type across the Season's Games, and is zero for any type with no recorded
   * Statistic (Req 8.7).
   *
   * @throws NotFoundError if the Player does not exist.
   */
  async getPlayerSeasonStats(
    seasonId: string,
    playerId: string,
  ): Promise<StatisticTotals> {
    return withTransaction(this.db, async (tx) => {
      const player = await playerRepository.findById(playerId, tx);
      if (!player) {
        throw new NotFoundError('The specified Player does not exist.', {
          playerId,
        });
      }

      const seasonStatistics = await this.listSeasonStatistics(seasonId, tx);

      // Resolve the Player's Team for this Season via their assignment. A
      // Player holds at most one assignment per Season; if they have none they
      // contribute no Team mapping (their per-Player totals are still reported,
      // just unattributed to any Team) (Req 5.4).
      const seasonAssignments =
        await rosterAssignmentRepository.listByPlayerInSeason(
          playerId,
          seasonId,
          tx,
        );
      const playerTeamById: Record<string, string> = {};
      const assignment = seasonAssignments[0];
      if (assignment) {
        playerTeamById[playerId] = assignment.teamId;
      }
      const roster: RosterContext = { playerTeamById };

      const aggregated = aggregateStatistics(
        seasonStatistics.filter((s) => s.playerId === playerId),
        roster,
      );
      // aggregateStatistics seeds the Player from the roster context, so the
      // totals are always present with zero-filled types (Req 8.7).
      return aggregated.perPlayer[playerId] ?? zeroTotals();
    });
  }

  /**
   * Season total for each of the six Statistic_Type values for a Team (Req 8.8),
   * summed across all Players on that Team for the Season. Types with no
   * recorded Statistic report zero (Req 8.7).
   *
   * @throws NotFoundError if the Team does not exist.
   */
  async getTeamSeasonStats(
    seasonId: string,
    teamId: string,
  ): Promise<StatisticTotals> {
    return withTransaction(this.db, async (tx) => {
      const team = await teamRepository.findById(teamId, tx);
      if (!team) {
        throw new NotFoundError('The specified Team does not exist.', {
          teamId,
        });
      }

      const roster = await rosterAssignmentRepository.listByTeam(teamId, tx);
      const playerTeamById: Record<string, string> = {};
      for (const assignment of roster) {
        playerTeamById[assignment.playerId] = teamId;
      }

      const rosterPlayerIds = new Set(
        roster.map((assignment) => assignment.playerId),
      );
      const seasonStatistics = await this.listSeasonStatistics(seasonId, tx);

      const aggregated = aggregateStatistics(
        seasonStatistics.filter((s) => rosterPlayerIds.has(s.playerId)),
        { playerTeamById },
      );
      // The Team is seeded from the roster context (even with an empty roster
      // it is present), so its zero-filled totals are always defined (Req 8.7).
      return aggregated.perTeam[teamId] ?? zeroTotals();
    });
  }

  // -------------------------------------------------------------------------
  // Internal helpers
  // -------------------------------------------------------------------------

  /**
   * Build the {@link EligibilityContext} for a Game by mapping each Player
   * holding a Roster_Assignment to either participating Team to that Team
   * (Req 8.5, 5.2, 5.3). Both Teams belong to the Game's Season, so an
   * assignment to the home or away Team is an assignment within that Season; a
   * Player without such an assignment is absent from the map and treated as not
   * eligible by the pure validator.
   */
  private async buildEligibilityContext(
    game: Game,
    ex: Executor,
  ): Promise<EligibilityContext> {
    const [homeRoster, awayRoster] = await Promise.all([
      rosterAssignmentRepository.listByTeam(game.homeTeamId, ex),
      rosterAssignmentRepository.listByTeam(game.awayTeamId, ex),
    ]);

    const playerTeamById: Record<string, string> = {};
    for (const assignment of homeRoster) {
      playerTeamById[assignment.playerId] = assignment.teamId;
    }
    for (const assignment of awayRoster) {
      playerTeamById[assignment.playerId] = assignment.teamId;
    }

    return {
      homeTeamId: game.homeTeamId,
      awayTeamId: game.awayTeamId,
      playerTeamById,
    };
  }

  /**
   * List every Statistic recorded in the Season, gathered by first finding the
   * Season's Games and then the Statistics for each of those Games. Statistics
   * are associated with Games (which belong to a Season), so scoping by the
   * Season's Games yields exactly the Season's Statistics.
   */
  private async listSeasonStatistics(
    seasonId: string,
    ex: Executor,
  ): Promise<Statistic[]> {
    const games = await gameRepository.listBySeason(seasonId, ex);
    const perGame = await Promise.all(
      games.map((game) => statisticRepository.listByGame(game.id, ex)),
    );
    return perGame.flat();
  }

  /**
   * Map a pure-domain rejection reason to the appropriate typed error. An
   * unsupported type or invalid value is a 400 ValidationError (Req 8.3, 8.4);
   * an ineligible Player is a 400 ValidationError indicating the Player is not
   * eligible for the Game (Req 8.5).
   */
  private rejectionToError(
    reason: 'invalid_value' | 'unsupported_type' | 'player_not_eligible',
    cmd: RecordStatisticCommand,
  ): ValidationError {
    switch (reason) {
      case 'unsupported_type':
        return new ValidationError(
          'The Statistic_Type is not supported; it must be one of the six permitted values.',
          { field: 'type', type: cmd.type },
        );
      case 'invalid_value':
        return new ValidationError(
          'The Statistic value must be a non-negative integer between 0 and 999.',
          { field: 'value', value: cmd.value },
        );
      case 'player_not_eligible':
        return new ValidationError(
          'The Player is not eligible for that Game; the Player must be on one of the two participating Teams.',
          { field: 'playerId', playerId: cmd.playerId, gameId: cmd.gameId },
        );
    }
  }
}

/**
 * Convenience factory mirroring the pattern used by the other services: build a
 * {@link StatisticsService} bound to a {@link Database} handle.
 */
export function createStatisticsService(db: Database): StatisticsService {
  return new StatisticsService(db);
}
