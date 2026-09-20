/**
 * AwardsService — statistical Awards computation and publication (Requirement 13).
 *
 * Orchestrates the Awards use cases by delegating the pure selection logic to
 * the domain functions `computeRegularSeasonAwards` (src/domain/awards.ts) and
 * `computeFinalsMvp` (src/domain/finals.ts), then persisting, publishing, and
 * reading Awards through the Repository Layer. It contains no HTTP concerns and
 * performs its multi-read/write flows inside a single transaction so a rejected
 * or empty computation leaves stored Awards unchanged.
 *
 * Responsibilities:
 * - `computeAwards(scopeId)`      — gather the scope's regular-season and
 *   playoff Statistics, compute the five regular-season stat-based Awards
 *   (Req 13.1–13.8) and, when the scope has completed Finals Games, the Finals
 *   MVP (Req 13.9–13.11). Newly computed Awards are persisted UNPUBLISHED so
 *   they stay hidden from Viewers until explicitly published (Req 13.13–13.15).
 *   Surfaces the no-Statistics indication (Req 13.16) and the no-Finals
 *   indication (Req 13.12) instead of failing.
 * - `publishAwards(scopeId)`      — mark every Award for the scope published so
 *   Viewers can see them (Req 13.13).
 * - `getPublishedAwards(scopeId)` — return only the published Awards for a
 *   scope, the exact subset a Viewer may see (Req 13.14, 13.15, Property 38).
 *
 * The champion Team (whose roster forms the Finals MVP candidate pool) is
 * derived from the Finals Playoff_Round's Series using the pure `resolveSeries`
 * function applied to completed Finals Game Scores; no champion state is
 * persisted here.
 *
 * _Requirements: 13.12, 13.13, 13.14, 13.15, 13.16_
 */

import {
  computeRegularSeasonAwards,
  type RegularSeasonAwards,
} from '../domain/awards.js';
import {
  computeFinalsMvp,
  type FinalsCandidate,
} from '../domain/finals.js';
import { resolveSeries, type SeriesGameWinner } from '../domain/series.js';
import type {
  Award,
  AwardCategory,
  Game,
  Player,
  Score,
  Statistic,
} from '../domain/types.js';
import type { Database, Executor } from '../repositories/executor.js';
import { withTransaction } from '../repositories/executor.js';
import {
  awardRepository,
  gameRepository,
  playerRepository,
  playoffRoundRepository,
  scoreRepository,
  seriesRepository,
  statisticRepository,
} from '../repositories/index.js';

// ---------------------------------------------------------------------------
// Result shapes
// ---------------------------------------------------------------------------

/**
 * Outcome of {@link AwardsService.computeAwards}.
 *
 * The freshly persisted (unpublished) Awards are returned together with two
 * informational indications so callers can surface them without treating an
 * empty computation as an error:
 * - `regularSeasonAvailable === false` → no Player had any regular-season
 *   Statistics for the scope, so no regular-season stat-based Award was
 *   computed (Req 13.16).
 * - `finalsMvpAvailable === false` → the scope has no completed Finals Games,
 *   so no Finals MVP was computed (Req 13.12).
 */
export interface ComputeAwardsResult {
  /** The Awards persisted by this computation, all unpublished (Req 13.13–13.15). */
  awards: Award[];
  /** False when no regular-season Statistics exist for the scope (Req 13.16). */
  regularSeasonAvailable: boolean;
  /** False when the scope has no completed Finals Games (Req 13.12). */
  finalsMvpAvailable: boolean;
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Maps a {@link RegularSeasonAwards} single/multi-winner field onto its
 * persisted {@link AwardCategory} together with the ordered Player ids.
 */
interface AwardSpec {
  category: AwardCategory;
  playerIds: string[];
}

/** The five regular-season stat-based Awards, in a stable category order. */
function regularSeasonAwardSpecs(awards: RegularSeasonAwards): AwardSpec[] {
  return [
    { category: 'MVP', playerIds: [awards.mvp] },
    { category: 'Mythical_5', playerIds: [...awards.mythical5] },
    { category: 'Best_in_3_Pointers', playerIds: [awards.bestIn3Pointers] },
    { category: 'DPOY', playerIds: [awards.dpoy] },
    { category: 'Assists_Leader', playerIds: [awards.assistsLeader] },
  ];
}

/**
 * Determine the per-Game winner (home vs away) for a completed Game from its
 * Score, expressed relative to a Series' Team A / Team B. Returns `null` when
 * the Game has no Score, is a tie (no winner), or does not involve exactly the
 * two Series Teams.
 */
function seriesGameWinner(
  game: Game,
  score: Score,
  teamAId: string,
  teamBId: string,
): SeriesGameWinner | null {
  if (score.homeScore === score.awayScore) {
    return null;
  }
  const homeWon = score.homeScore > score.awayScore;
  const winningTeamId = homeWon ? game.homeTeamId : game.awayTeamId;
  if (winningTeamId === teamAId) return 'A';
  if (winningTeamId === teamBId) return 'B';
  return null;
}

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

/**
 * Application service for statistical Awards. Construct it with a
 * {@link Database} handle; each method opens its own transaction so the
 * gather-compute-persist flow is atomic and non-mutating on failure.
 */
export class AwardsService {
  constructor(private readonly db: Database) {}

  /**
   * Compute and persist the Awards for a Season/Tournament scope (Req 13.1–13.11).
   *
   * Gathers every Statistic for the scope's Games, classifies each Game as
   * regular-season (`playoffRoundId === null`) or playoff, and:
   *  - computes the five regular-season stat-based Awards from regular-season
   *    Statistics only (Req 13.1–13.8), or reports the no-Statistics indication
   *    when no regular-season Statistics exist (Req 13.16);
   *  - computes the Finals MVP from the Series-winning champion Team's roster
   *    when the scope has completed Finals Games (Req 13.9–13.11), or reports
   *    the no-Finals indication otherwise (Req 13.12).
   *
   * All Awards produced are persisted UNPUBLISHED so they remain hidden from
   * Viewers until {@link publishAwards} is called (Req 13.13–13.15). Any Awards
   * previously computed for the scope are replaced.
   */
  async computeAwards(scopeId: string): Promise<ComputeAwardsResult> {
    return withTransaction(this.db, async (tx) => {
      const games = await gameRepository.listBySeason(scopeId, tx);

      const regularSeasonGameIds = new Set(
        games.filter((g) => g.playoffRoundId === null).map((g) => g.id),
      );
      const playoffGames = games.filter((g) => g.playoffRoundId !== null);
      const playoffGameIds = new Set(playoffGames.map((g) => g.id));

      // Gather every Statistic recorded across the scope's Games.
      const allStatistics: Statistic[] = [];
      for (const game of games) {
        const stats = await statisticRepository.listByGame(game.id, tx);
        allStatistics.push(...stats);
      }

      // A Player-name lookup covers only Players referenced by Statistics; it is
      // used solely for the alphabetical tiebreak.
      const playerNameById = await this.loadPlayerNames(
        new Set(allStatistics.map((s) => s.playerId)),
        tx,
      );

      // --- Regular-season stat-based Awards (Req 13.1–13.8, 13.16) ----------
      const regularResult = computeRegularSeasonAwards({
        statistics: allStatistics,
        regularSeasonGameIds,
        playerNameById,
      });

      const specs: AwardSpec[] = [];
      if (regularResult.available) {
        specs.push(...regularSeasonAwardSpecs(regularResult.awards));
      }

      // --- Finals MVP (Req 13.9–13.12) --------------------------------------
      const finals = await this.computeFinalsMvpForScope(
        scopeId,
        playoffGames,
        playoffGameIds,
        allStatistics,
        tx,
      );
      if (finals.available) {
        specs.push({ category: 'Finals_MVP', playerIds: [finals.playerId] });
      }

      // --- Persist as unpublished (Req 13.13–13.15) -------------------------
      // Replace any Awards previously computed for this scope so a recompute is
      // idempotent and never leaves stale entries.
      const existing = await awardRepository.listByScope(scopeId, tx);
      for (const award of existing) {
        await awardRepository.delete(award.id, tx);
      }

      const created: Award[] = [];
      for (const spec of specs) {
        const award = await awardRepository.create(
          { scopeId, category: spec.category, published: false },
          spec.playerIds,
          tx,
        );
        created.push(award);
      }

      return {
        awards: created,
        regularSeasonAvailable: regularResult.available,
        finalsMvpAvailable: finals.available,
      };
    });
  }

  /**
   * Publish every Award for a scope so Viewers can see them (Req 13.13).
   *
   * @returns The published Awards for the scope. When the scope has no computed
   *   Awards, returns an empty array.
   */
  async publishAwards(scopeId: string): Promise<Award[]> {
    return withTransaction(this.db, async (tx) => {
      const awards = await awardRepository.listByScope(scopeId, tx);
      const published: Award[] = [];
      for (const award of awards) {
        const updated = await awardRepository.setPublished(award.id, true, tx);
        if (updated) {
          published.push(updated);
        }
      }
      return published;
    });
  }

  /**
   * Return only the published Awards for a scope — the exact subset a Viewer is
   * allowed to see (Req 13.14, 13.15, Property 38). Unpublished Awards remain
   * hidden.
   */
  async getPublishedAwards(scopeId: string): Promise<Award[]> {
    const awards = await awardRepository.listByScope(scopeId, this.db);
    return awards.filter((a) => a.published);
  }

  // -------------------------------------------------------------------------
  // Private helpers
  // -------------------------------------------------------------------------

  /**
   * Load a Player-id → name lookup for the given Player ids. A Player id absent
   * from the store is simply omitted (the domain functions treat a missing name
   * as empty for tiebreak purposes).
   */
  private async loadPlayerNames(
    playerIds: ReadonlySet<string>,
    ex: Executor,
  ): Promise<Record<string, string>> {
    const names: Record<string, string> = {};
    for (const playerId of playerIds) {
      const player = await playerRepository.findById(playerId, ex);
      if (player) {
        names[player.id] = player.name;
      }
    }
    return names;
  }

  /**
   * Compute the Finals MVP for a scope (Req 13.9–13.12).
   *
   * Determines the champion Team from the Finals Playoff_Round's Series (using
   * the pure `resolveSeries` over completed Finals Game Scores), restricts the
   * candidate pool to that Team's roster, and delegates the selection to the
   * pure `computeFinalsMvp`. Returns the no-Finals indication when the scope has
   * no completed Finals Games or no decided Finals Series (Req 13.12).
   */
  private async computeFinalsMvpForScope(
    scopeId: string,
    playoffGames: readonly Game[],
    playoffGameIds: ReadonlySet<string>,
    allStatistics: readonly Statistic[],
    ex: Executor,
  ): Promise<{ available: true; playerId: string } | { available: false }> {
    const rounds = await playoffRoundRepository.listBySeason(scopeId, ex);
    const finalsRoundIds = new Set(
      rounds.filter((r) => r.type === 'Finals').map((r) => r.id),
    );
    if (finalsRoundIds.size === 0) {
      return { available: false };
    }

    // Finals Games are the playoff Games attached to a Finals Playoff_Round.
    const finalsGames = playoffGames.filter(
      (g) => g.playoffRoundId !== null && finalsRoundIds.has(g.playoffRoundId),
    );

    // Load Scores for the Finals Games to identify completed Games and winners.
    const finalsScoreByGame = new Map<string, Score>();
    for (const game of finalsGames) {
      const score = await scoreRepository.findByGame(game.id, ex);
      if (score) {
        finalsScoreByGame.set(game.id, score);
      }
    }
    const completedFinalsGames = finalsGames.filter(
      (g) => g.status === 'completed' && finalsScoreByGame.has(g.id),
    );

    // Req 13.12: no completed Finals Games → no Finals MVP.
    if (completedFinalsGames.length === 0) {
      return { available: false };
    }

    // Determine the champion Team from a decided Finals Series.
    const championTeamId = await this.resolveChampionTeam(
      finalsRoundIds,
      completedFinalsGames,
      finalsScoreByGame,
      ex,
    );
    if (championTeamId === null) {
      return { available: false };
    }

    // Req 13.9: restrict the candidate pool to the champion Team's roster.
    const roster = await playerRepository.listByTeam(championTeamId, ex);
    const championTeamPlayers: FinalsCandidate[] = roster.map((p: Player) => ({
      playerId: p.id,
      name: p.name,
    }));
    if (championTeamPlayers.length === 0) {
      return { available: false };
    }

    const completedFinalsGameIds = new Set(
      completedFinalsGames.map((g) => g.id),
    );
    const finalsStatistics = allStatistics.filter((s) =>
      completedFinalsGameIds.has(s.gameId),
    );
    const allPlayoffStatistics = allStatistics.filter((s) =>
      playoffGameIds.has(s.gameId),
    );

    const result = computeFinalsMvp({
      championTeamPlayers,
      finalsStatistics,
      allPlayoffStatistics,
      hasCompletedFinals: true,
    });

    if (!result.available) {
      return { available: false };
    }
    return { available: true, playerId: result.playerId };
  }

  /**
   * Resolve the champion Team id from the Finals Playoff_Round(s).
   *
   * For each Series in a Finals Round, replays the completed Finals Games'
   * winners in date order through the pure `resolveSeries`; the first Series
   * that is decided yields the champion. Returns `null` when no Finals Series
   * has reached a majority (no champion yet).
   */
  private async resolveChampionTeam(
    finalsRoundIds: ReadonlySet<string>,
    completedFinalsGames: readonly Game[],
    scoreByGame: ReadonlyMap<string, Score>,
    ex: Executor,
  ): Promise<string | null> {
    for (const roundId of finalsRoundIds) {
      const seriesList = await seriesRepository.listByRound(roundId, ex);
      for (const s of seriesList) {
        const seriesGames = completedFinalsGames
          .filter((g) => g.seriesId === s.id)
          .slice()
          .sort((a, b) => a.date.getTime() - b.date.getTime());

        const winners: SeriesGameWinner[] = [];
        for (const game of seriesGames) {
          const score = scoreByGame.get(game.id);
          if (!score) continue;
          const winner = seriesGameWinner(game, score, s.teamAId, s.teamBId);
          if (winner) {
            winners.push(winner);
          }
        }

        const outcome = resolveSeries(s.bestOf, winners);
        if (outcome.decided) {
          return outcome.winner === 'A' ? s.teamAId : s.teamBId;
        }
      }
    }
    return null;
  }
}

/**
 * Convenience factory mirroring the pattern used by the other services: build
 * an {@link AwardsService} bound to a {@link Database} handle.
 */
export function createAwardsService(db: Database): AwardsService {
  return new AwardsService(db);
}
