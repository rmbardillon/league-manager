/**
 * Pure standings ranking for the Basketball League Management System.
 *
 * This module implements the pure, I/O-free `rankTeams` comparator described in
 * the design document (StandingsService, Property 15). It ranks Teams for a
 * Season using the full deterministic comparator:
 *
 *   1. wins descending                                         (Req 7.1)
 *   2. losses ascending                                        (Req 7.2)
 *   3. head-to-head wins among the currently tied Teams        (Req 7.3)
 *   4. Points_Ratio descending, zero points allowed = highest  (Req 7.4, 7.5)
 *   5. Team name ascending                                     (Req 7.6)
 *
 * Teams that are identical on every criterion (including name) receive the
 * SAME rank value (Req 7.7). The same input always produces the same output.
 *
 * Points_Ratio is derived from Game Scores (the recorded final scores of
 * completed Games per Requirement 6) and NOT from the per-Player "Points"
 * Statistic (Req 7.4; Glossary: Points_Ratio).
 *
 * _Requirements: 7.1, 7.2, 7.3, 7.4, 7.5, 7.6, 7.7_
 */

import type { Game, Score, StandingRow, Team } from './types.js';

/**
 * A completed Game paired with its recorded Score. Only completed Games with a
 * Score contribute to wins, losses, and Points_Ratio; scheduled/cancelled Games
 * and Games without a Score are ignored by {@link rankTeams}.
 */
export interface ScoredGame {
  game: Game;
  score: Score;
}

/** Internal accumulator of a Team's derived standings metrics. */
interface TeamStats {
  teamId: string;
  name: string;
  wins: number;
  losses: number;
  pointsFor: number;
  pointsAllowed: number;
}

/**
 * Rank a Season's Teams into a deterministic {@link StandingRow} list.
 *
 * @param teams The Teams to rank. The list defines the universe of Teams; a
 *   Team with no completed Games still appears with zero wins/losses.
 * @param scoredGames Completed Games paired with their Scores. Games whose
 *   `status` is not `'completed'` are ignored, as are Games referencing Teams
 *   outside `teams`.
 * @returns One {@link StandingRow} per input Team, ordered best-to-worst.
 *   Teams tied on every criterion (including name) share the same `rank` value;
 *   ranks use standard competition ranking (equal ranks, with the next distinct
 *   rank skipping by the size of the tied group).
 */
export function rankTeams(
  teams: readonly Team[],
  scoredGames: readonly ScoredGame[],
): StandingRow[] {
  const statsById = new Map<string, TeamStats>();
  for (const team of teams) {
    statsById.set(team.id, {
      teamId: team.id,
      name: team.name,
      wins: 0,
      losses: 0,
      pointsFor: 0,
      pointsAllowed: 0,
    });
  }

  // Only completed Games between two known Teams contribute to the metrics.
  const relevantGames = scoredGames.filter(
    (sg) =>
      sg.game.status === 'completed' &&
      statsById.has(sg.game.homeTeamId) &&
      statsById.has(sg.game.awayTeamId),
  );

  for (const { game, score } of relevantGames) {
    const home = statsById.get(game.homeTeamId)!;
    const away = statsById.get(game.awayTeamId)!;

    home.pointsFor += score.homeScore;
    home.pointsAllowed += score.awayScore;
    away.pointsFor += score.awayScore;
    away.pointsAllowed += score.homeScore;

    if (score.homeScore > score.awayScore) {
      home.wins += 1;
      away.losses += 1;
    } else if (score.awayScore > score.homeScore) {
      away.wins += 1;
      home.losses += 1;
    }
    // Ties in a single Game affect neither wins nor losses.
  }

  const allStats = [...statsById.values()];

  // Sort into best-to-worst order using the full comparator. Head-to-head is
  // computed lazily within the comparator, scoped to the two Teams being
  // compared plus any Teams tied with them on wins and losses.
  const ordered = [...allStats].sort((a, b) =>
    compareTeams(a, b, allStats, relevantGames),
  );

  // Assign ranks with standard competition ranking: fully-tied Teams (equal on
  // every criterion, i.e. the comparator returns 0) share a rank value, and the
  // following distinct group's rank skips by the size of the tied group.
  const rows: StandingRow[] = [];
  let currentRank = 0;
  for (let i = 0; i < ordered.length; i++) {
    const stats = ordered[i]!;
    const isTiedWithPrev =
      i > 0 &&
      compareTeams(ordered[i - 1]!, stats, allStats, relevantGames) === 0;
    if (!isTiedWithPrev) {
      currentRank = i + 1;
    }
    rows.push({
      teamId: stats.teamId,
      wins: stats.wins,
      losses: stats.losses,
      rank: currentRank,
    });
  }

  return rows;
}

/**
 * Full standings comparator. Returns a negative number when `a` ranks ahead of
 * `b`, positive when `b` ranks ahead of `a`, and 0 when they are identical on
 * every criterion (Req 7.7).
 */
function compareTeams(
  a: TeamStats,
  b: TeamStats,
  allStats: readonly TeamStats[],
  games: readonly ScoredGame[],
): number {
  // 1. Wins descending (Req 7.1).
  if (a.wins !== b.wins) {
    return b.wins - a.wins;
  }

  // 2. Losses ascending (Req 7.2).
  if (a.losses !== b.losses) {
    return a.losses - b.losses;
  }

  // 3. Head-to-head wins among the tied Teams (Req 7.3). The tied group is
  //    every Team sharing this wins/losses pair; head-to-head wins are counted
  //    only in Games played directly among those tied Teams.
  const tiedGroup = allStats.filter(
    (s) => s.wins === a.wins && s.losses === a.losses,
  );
  if (tiedGroup.length > 1) {
    const tiedIds = new Set(tiedGroup.map((s) => s.teamId));
    const aH2h = headToHeadWins(a.teamId, tiedIds, games);
    const bH2h = headToHeadWins(b.teamId, tiedIds, games);
    if (aH2h !== bH2h) {
      return bH2h - aH2h; // more head-to-head wins ranks higher
    }
  }

  // 4. Points_Ratio descending, treating zero points allowed as the highest
  //    ratio (Req 7.4, 7.5). Computed from Game Scores.
  const ratioCmp = comparePointsRatio(a, b);
  if (ratioCmp !== 0) {
    return ratioCmp;
  }

  // 5. Team name ascending as the final deterministic tiebreaker (Req 7.6).
  if (a.name !== b.name) {
    return a.name < b.name ? -1 : 1;
  }

  // Identical on every criterion including name → same rank (Req 7.7).
  return 0;
}

/**
 * Count `teamId`'s wins in completed Games played directly against the other
 * Teams in `tiedIds`. Only Games where BOTH participants are in the tied group
 * are counted (Req 7.3; Glossary: Head_to_Head).
 */
function headToHeadWins(
  teamId: string,
  tiedIds: ReadonlySet<string>,
  games: readonly ScoredGame[],
): number {
  let wins = 0;
  for (const { game, score } of games) {
    const { homeTeamId, awayTeamId } = game;
    if (!tiedIds.has(homeTeamId) || !tiedIds.has(awayTeamId)) {
      continue;
    }
    if (homeTeamId === teamId && score.homeScore > score.awayScore) {
      wins += 1;
    } else if (awayTeamId === teamId && score.awayScore > score.homeScore) {
      wins += 1;
    }
  }
  return wins;
}

/**
 * Compare two Teams by Points_Ratio (points scored / points allowed from Game
 * Scores), descending. A Team with zero points allowed is treated as having a
 * higher ratio than any Team with non-zero points allowed (Req 7.5). Comparison
 * avoids floating-point division by cross-multiplying the ratios.
 *
 * @returns negative if `a` ranks ahead of `b`, positive if `b` ahead of `a`,
 *   0 if the ratios are equal.
 */
function comparePointsRatio(a: TeamStats, b: TeamStats): number {
  const aZeroAllowed = a.pointsAllowed === 0;
  const bZeroAllowed = b.pointsAllowed === 0;

  if (aZeroAllowed || bZeroAllowed) {
    if (aZeroAllowed && bZeroAllowed) {
      // Both "infinite": order by points scored so more scoring ranks higher,
      // keeping the comparator total and deterministic.
      if (a.pointsFor !== b.pointsFor) {
        return b.pointsFor - a.pointsFor;
      }
      return 0;
    }
    // Exactly one has zero points allowed → that Team ranks higher (Req 7.5).
    return aZeroAllowed ? -1 : 1;
  }

  // Both have non-zero points allowed: compare a.pF/a.pA vs b.pF/b.pA via
  // cross-multiplication. Descending ratio → the larger cross product first.
  const lhs = a.pointsFor * b.pointsAllowed;
  const rhs = b.pointsFor * a.pointsAllowed;
  if (lhs !== rhs) {
    return rhs - lhs;
  }
  return 0;
}
