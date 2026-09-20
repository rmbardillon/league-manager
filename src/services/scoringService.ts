/**
 * ScoringService — application service for Score recording and correction
 * (Requirement 6).
 *
 * Orchestrates the {@link gameRepository} and {@link scoreRepository} to record
 * initial Scores and correct Scores of already-completed Games, enforcing the
 * business rules the data-access layer intentionally omits:
 *
 *   - Each Team's Score is an integer between 0 and 999 inclusive; a negative,
 *     non-integer, out-of-range, or missing value is rejected and any
 *     previously recorded Score is retained (Req 6.2).
 *   - `recordScore` targets a Game not yet completed: it records the Score and
 *     marks the Game completed atomically (Req 6.1). Submitting an initial
 *     Score for a Game already marked completed is rejected with a
 *     {@link ConstraintError} directing the caller to score correction
 *     (Req 6.5).
 *   - `correctScore` targets an already-completed Game: it saves the updated
 *     Score (Req 6.4). Correcting a Game that is not completed is rejected.
 *   - Both operations trigger a Standings recalculation for the Game's Season
 *     (Req 6.3 / 6.4).
 *
 * The read-then-write use cases (status check → Score upsert → Game completion)
 * run inside a single {@link withTransaction} unit so the guard, the writes,
 * and the Standings recalculation are atomic; a rejected operation leaves any
 * previously recorded Score unchanged.
 *
 * Standings recalculation is delivered through an injected
 * {@link RecomputeStandings} callback rather than a direct import of the
 * StandingsService, keeping the two services decoupled while StandingsService is
 * built concurrently and letting the recomputation share this service's
 * transaction.
 *
 * _Requirements: 6.1, 6.2, 6.3, 6.4, 6.5_
 */
import { db } from '../db/client.js';
import { ConstraintError, NotFoundError, ValidationError } from '../domain/errors.js';
import type { Score } from '../domain/types.js';
import {
  gameRepository,
  scoreRepository,
  withTransaction,
  type Executor,
} from '../repositories/index.js';

/** Inclusive lower bound for a valid Team Score (Req 6.2). */
const SCORE_MIN = 0;
/** Inclusive upper bound for a valid Team Score (Req 6.2). */
const SCORE_MAX = 999;

/**
 * Hook invoked after a Score write to recalculate the Season's Standings
 * (Req 6.3 / 6.4). It runs inside the same transaction (`ex`) as the Score
 * write so the recalculation observes the just-written Score and rolls back
 * with it on failure.
 *
 * Injected rather than imported so ScoringService stays decoupled from the
 * concurrently-developed StandingsService (e.g. bind
 * `standingsService.computeStandings`).
 */
export type RecomputeStandings = (seasonId: string, ex: Executor) => Promise<void>;

/** The pair of final scores submitted for a Game (Req 6.1 / 6.4). */
export interface ScoreInput {
  /** Home Team final score; integer 0–999 (Req 6.2). */
  homeScore: number;
  /** Away Team final score; integer 0–999 (Req 6.2). */
  awayScore: number;
}

/**
 * Validate a single Team's Score value: it must be a present, finite integer
 * within 0–999 inclusive (Req 6.2).
 *
 * @throws {ValidationError} identifying the offending field when the value is
 *   missing, non-integer, negative, or out of range.
 */
function validateScoreValue(value: number, field: 'homeScore' | 'awayScore'): void {
  if (value === undefined || value === null || Number.isNaN(value)) {
    throw new ValidationError(`A Score value for ${field} is required.`, { field });
  }
  if (!Number.isInteger(value)) {
    throw new ValidationError(`The ${field} value must be an integer.`, { field, value });
  }
  if (value < SCORE_MIN || value > SCORE_MAX) {
    throw new ValidationError(
      `The ${field} value must be between ${SCORE_MIN} and ${SCORE_MAX} inclusive.`,
      { field, value },
    );
  }
}

/**
 * Validate both Team Scores, reporting every invalid value (Req 6.2). Home is
 * checked before away so the first offending field is surfaced deterministically.
 */
function validateScoreInput(input: ScoreInput): void {
  validateScoreValue(input.homeScore, 'homeScore');
  validateScoreValue(input.awayScore, 'awayScore');
}

/**
 * Build a ScoringService bound to a Standings recalculation hook.
 *
 * @param recomputeStandings runs inside the Score-write transaction to refresh
 *   the Season's Standings (Req 6.3 / 6.4).
 */
export function createScoringService(recomputeStandings: RecomputeStandings) {
  return {
    /**
     * Record the initial Score for a Game not yet marked completed (Req 6.1).
     *
     * Validates that each Team's value is an integer 0–999 (Req 6.2), rejects a
     * Game that is already completed and directs the caller to score correction
     * (Req 6.5), then upserts the Score, marks the Game completed, and
     * recalculates the Season Standings atomically (Req 6.1 / 6.3). Any
     * previously recorded Score is retained on a validation failure (Req 6.2).
     *
     * @throws {ValidationError} when a Score value is invalid (Req 6.2).
     * @throws {NotFoundError} when the Game does not exist.
     * @throws {ConstraintError} when the Game is already completed (Req 6.5).
     */
    async recordScore(gameId: string, input: ScoreInput): Promise<Score> {
      validateScoreValue(input.homeScore, 'homeScore');
      validateScoreValue(input.awayScore, 'awayScore');
      return withTransaction(db, async (tx) => {
        const game = await gameRepository.findById(gameId, tx);
        if (!game) {
          throw new NotFoundError('Game was not found.', { field: 'gameId', gameId });
        }
        if (game.status === 'completed') {
          throw new ConstraintError(
            'Game is already completed; use score correction instead.',
            { field: 'gameId', gameId },
          );
        }
        const score = await scoreRepository.upsert(
          {
            gameId,
            homeScore: input.homeScore,
            awayScore: input.awayScore,
            completedAt: new Date(),
          },
          tx,
        );
        await gameRepository.setStatus(gameId, 'completed', tx);
        await recomputeStandings(game.seasonId, tx);
        return score;
      });
    },

    /**
     * Correct the Score of an already-completed Game (Req 6.4).
     *
     * Validates that each Team's value is an integer 0–999 (Req 6.2), rejects a
     * Game that is not completed (correction applies only to completed Games),
     * then saves the updated Score and recalculates the Season Standings
     * atomically (Req 6.4). The Game remains completed; any previously recorded
     * Score is retained on a validation failure (Req 6.2).
     *
     * @throws {ValidationError} when a Score value is invalid (Req 6.2).
     * @throws {NotFoundError} when the Game does not exist.
     * @throws {ConstraintError} when the Game is not completed.
     */
    async correctScore(gameId: string, input: ScoreInput): Promise<Score> {
      validateScoreInput(input);
      return withTransaction(db, async (tx) => {
        const game = await gameRepository.findById(gameId, tx);
        if (!game) {
          throw new NotFoundError('Game was not found.', { field: 'gameId', gameId });
        }
        if (game.status !== 'completed') {
          throw new ConstraintError(
            'Score correction applies only to a completed Game.',
            { field: 'gameId', gameId, status: game.status },
          );
        }
        const score = await scoreRepository.upsert(
          {
            gameId,
            homeScore: input.homeScore,
            awayScore: input.awayScore,
            completedAt: new Date(),
          },
          tx,
        );
        await recomputeStandings(game.seasonId, tx);
        return score;
      });
    },
  };
}

/** The concrete service type produced by {@link createScoringService}. */
export type ScoringService = ReturnType<typeof createScoringService>;
