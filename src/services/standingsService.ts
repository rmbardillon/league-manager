/**
 * StandingsService — application service for Season Standings (Requirement 7,
 * Requirements 10.4 and 10.5).
 *
 * Orchestrates the Repository Layer around the pure `rankTeams` domain function
 * (src/domain/standings.ts) to answer "what are the Standings for this Season?"
 * while enforcing the two rules the pure comparator cannot know about on its
 * own:
 *
 *   - An open Season's Standings are always computed live from the current
 *     Teams and completed Games (Req 10.4). A Season with no Teams yields an
 *     empty list rather than an error (Req 7.9).
 *   - A closed Season's Standings are the snapshot recorded at close time and
 *     are returned unchanged, independent of any later change to the underlying
 *     Games, Scores, or Teams (Req 10.5, Property 17).
 *
 * Each computed row exposes the Team's wins, losses, and rank (Req 7.8, 10.4),
 * which is exactly the shape produced by `rankTeams`.
 *
 * The load-then-rank flow runs inside a single {@link withTransaction} unit so
 * the Teams, Games, and Scores that feed a live computation are read from one
 * consistent snapshot of the database.
 *
 * The service is stateless apart from its {@link Database} handle; the "final
 * snapshot" is persisted on the Season row by the SeasonTournamentService's
 * `closeSeason` (via `seasonRepository.close`). This service reads that stored
 * snapshot back for a closed Season and never mutates it.
 *
 * _Requirements: 7.8, 7.9, 10.4, 10.5_
 */
import { NotFoundError } from '../domain/errors.js';
import { rankTeams, type ScoredGame } from '../domain/standings.js';
import type { StandingRow } from '../domain/types.js';
import type { Database, Executor } from '../repositories/executor.js';
import { withTransaction } from '../repositories/executor.js';
import {
  gameRepository,
  scoreRepository,
  seasonRepository,
  teamRepository,
} from '../repositories/index.js';

/**
 * Application service for Season Standings. Construct it with a {@link Database}
 * handle; each read opens its own transaction so a live computation sees a
 * consistent view of the Teams, Games, and Scores.
 */
export class StandingsService {
  constructor(private readonly db: Database) {}

  /**
   * Compute the Standings for a Season (Req 10.4).
   *
   * For an open Season the Standings are computed live: every Team in the
   * Season is ranked by the pure `rankTeams` comparator using the Season's
   * completed Games and their recorded Scores. A Season with no Teams produces
   * an empty list, not an error (Req 7.9).
   *
   * For a closed Season the recorded final Standings snapshot is returned
   * unchanged, regardless of any subsequent change to the underlying data
   * (Req 10.5, Property 17). If a closed Season somehow has no recorded
   * snapshot, an empty list is returned so callers never observe a failure for
   * a valid Season.
   *
   * Every returned row exposes the Team's wins, losses, and rank (Req 7.8).
   *
   * @param seasonId The Season whose Standings to compute.
   * @returns The Standings rows ordered best-to-worst.
   * @throws NotFoundError if the Season does not exist.
   */
  async computeStandings(seasonId: string): Promise<StandingRow[]> {
    return withTransaction(this.db, async (tx) => {
      const season = await seasonRepository.findById(seasonId, tx);
      if (!season) {
        throw new NotFoundError('The specified Season does not exist.', {
          seasonId,
        });
      }

      // Req 10.5 / Property 17: a closed Season returns its recorded snapshot
      // unchanged. Copy the rows so callers cannot mutate the stored snapshot
      // reference held by the Season entity.
      if (season.closed) {
        const snapshot = season.finalStandingsSnapshot ?? [];
        return snapshot.map((row) => ({ ...row }));
      }

      // Req 10.4: an open Season is computed live from the current data.
      return computeLiveStandings(seasonId, tx);
    });
  }

  /**
   * Recompute an open Season's live Standings. Intended for the ScoringService
   * to call after a Score is recorded or corrected so the Standings reflect the
   * new result (Req 6.3, 6.4).
   *
   * This is a thin alias for {@link computeStandings}: because a closed Season
   * rejects new Games and Score changes, recomputation only ever applies to an
   * open Season, and delegating keeps the closed-Season snapshot rule in one
   * place.
   *
   * @param seasonId The Season whose Standings to refresh.
   * @returns The recomputed Standings rows.
   * @throws NotFoundError if the Season does not exist.
   */
  async refreshStandings(seasonId: string): Promise<StandingRow[]> {
    return this.computeStandings(seasonId);
  }
}

/**
 * Load a Season's Teams and completed, scored Games, then rank them with the
 * pure `rankTeams` comparator. Runs against the supplied executor so it can
 * share the caller's transaction.
 *
 * Only completed Games that have a recorded Score contribute to the ranking;
 * `rankTeams` itself further ignores any Game whose status is not `'completed'`
 * or that references a Team outside the Season's Team list.
 */
async function computeLiveStandings(
  seasonId: string,
  ex: Executor,
): Promise<StandingRow[]> {
  const teams = await teamRepository.listBySeason(seasonId, ex);

  // Req 7.9: no Teams → empty Standings, not an error. Skip the Game/Score
  // reads entirely since there is nothing to rank.
  if (teams.length === 0) {
    return [];
  }

  const games = await gameRepository.listBySeason(seasonId, ex);

  const scoredGames: ScoredGame[] = [];
  for (const game of games) {
    if (game.status !== 'completed') {
      continue;
    }
    const score = await scoreRepository.findByGame(game.id, ex);
    // A completed Game is expected to have a Score; guard defensively so a
    // missing Score is simply excluded rather than throwing.
    if (score) {
      scoredGames.push({ game, score });
    }
  }

  return rankTeams(teams, scoredGames);
}

/**
 * Convenience factory mirroring the pattern used by the other services: build a
 * {@link StandingsService} bound to a {@link Database} handle.
 */
export function createStandingsService(db: Database): StandingsService {
  return new StandingsService(db);
}
