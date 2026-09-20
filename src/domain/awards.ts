/**
 * Pure regular-season Awards computation (Requirement 13).
 *
 * This module is I/O-free and deterministic so it can be exercised as universal
 * properties (design Properties 34, 35, and 36). It computes the five
 * regular-season, stat-based Awards from Player Statistics:
 *
 *  - MVP                — highest Combined_Statistic_Total (Req 13.2).
 *  - Mythical_5         — top five by Combined_Statistic_Total, descending
 *                         (Req 13.3, 13.8).
 *  - Best_in_3_Pointers — highest total Three_Pointers_Made (Req 13.4).
 *  - DPOY               — highest combined total of Steals and Blocks (Req 13.5).
 *  - Assists_Leader     — highest total Assists (Req 13.6).
 *
 * Only Statistics recorded in regular-season Games contribute; every playoff
 * Statistic is excluded before any metric is computed (Req 13.1, Property 34).
 * The exclusion is enforced inside this pure function via the set of
 * regular-season Game ids supplied by the caller.
 *
 * All single-winner Awards select the metric argmax, breaking ties by higher
 * total Points and then ascending Player name; the selection is deterministic
 * (Req 13.7, Property 35). Mythical 5 applies the same tiebreak at the
 * fifth-position boundary (Req 13.8, Property 36).
 *
 * Finals MVP (Req 13.9–13.11) is intentionally NOT implemented here; it lives
 * in a separate module because it draws on playoff Games.
 *
 * The function performs no I/O and mutates none of its arguments. Callers (the
 * AwardsService) are responsible for persisting the resulting Awards, applying
 * publication state, and reporting the no-Statistics indication to the API.
 *
 * _Requirements: 13.1, 13.2, 13.3, 13.4, 13.5, 13.6, 13.7, 13.8_
 */

import type { Statistic } from './types.js';

// ---------------------------------------------------------------------------
// Public result shapes
// ---------------------------------------------------------------------------

/** Number of Players recognized by the Mythical 5 Award. */
export const MYTHICAL_5_SIZE = 5;

/**
 * The five regular-season, stat-based Awards produced by
 * {@link computeRegularSeasonAwards} when at least one Player has recorded
 * regular-season Statistics.
 *
 * Each single-winner field holds one Player id; `mythical5` holds up to five
 * Player ids ordered by descending Combined_Statistic_Total (with the standard
 * tiebreak). When fewer than five Players have regular-season Statistics,
 * `mythical5` contains all of them in ranked order.
 */
export interface RegularSeasonAwards {
  /** Highest Combined_Statistic_Total (Req 13.2). */
  mvp: string;
  /** Top five by Combined_Statistic_Total, descending (Req 13.3, 13.8). */
  mythical5: string[];
  /** Highest total Three_Pointers_Made (Req 13.4). */
  bestIn3Pointers: string;
  /** Highest combined total of Steals and Blocks (Req 13.5). */
  dpoy: string;
  /** Highest total Assists (Req 13.6). */
  assistsLeader: string;
}

/**
 * Outcome of a regular-season Award computation.
 *
 * - `available: true` carries the computed {@link RegularSeasonAwards}.
 * - `available: false` indicates that no Player had any recorded regular-season
 *   Statistics, so no regular-season Award is available (Req 13.16). Callers
 *   should surface this as an informational empty result, not an error.
 */
export type RegularSeasonAwardsResult =
  | { available: true; awards: RegularSeasonAwards }
  | { available: false };

// ---------------------------------------------------------------------------
// Inputs
// ---------------------------------------------------------------------------

/**
 * Inputs to {@link computeRegularSeasonAwards}.
 *
 * The caller supplies every candidate Statistic together with the set of
 * regular-season Game ids and a Player-name lookup used only for the
 * alphabetical tiebreak. A Player referenced by a Statistic but absent from
 * `playerNameById` is treated as having an empty name for tiebreak purposes.
 */
export interface RegularSeasonAwardsInput {
  /** Candidate Statistics; playoff-Game Statistics are filtered out (Req 13.1). */
  statistics: readonly Statistic[];
  /**
   * Ids of the regular-season Games. A Statistic contributes if and only if its
   * `gameId` is in this set, guaranteeing playoff Statistics are excluded
   * (Property 34). Accepts a `Set` or any `readonly string[]`.
   */
  regularSeasonGameIds: ReadonlySet<string> | readonly string[];
  /** Maps a Player id to that Player's name for the alphabetical tiebreak. */
  playerNameById: Readonly<Record<string, string>>;
}

// ---------------------------------------------------------------------------
// Internal per-Player accumulator
// ---------------------------------------------------------------------------

/**
 * Per-Player regular-season totals for the metrics the Awards need. Points is
 * tracked separately because it is the primary tiebreak for every Award
 * (Req 13.7).
 */
interface PlayerMetrics {
  playerId: string;
  name: string;
  /** Combined_Statistic_Total: sum of all six Statistic_Type values (Req 13.2). */
  combinedTotal: number;
  /** Total Three_Pointers_Made (Req 13.4). */
  threePointers: number;
  /** Steals + Blocks (Req 13.5). */
  defensive: number;
  /** Total Assists (Req 13.6). */
  assists: number;
  /** Total Points — the primary tiebreak metric (Req 13.7). */
  points: number;
}

// ---------------------------------------------------------------------------
// Computation
// ---------------------------------------------------------------------------

/**
 * Compute the five regular-season, stat-based Awards from Player Statistics.
 *
 * Statistics recorded in playoff Games are excluded up front so that every
 * metric is derived from regular-season Games only (Req 13.1, Property 34).
 * Each single-winner Award selects the Player maximizing that Award's metric,
 * breaking ties by higher total Points and then ascending Player name; Mythical
 * 5 takes the top five by Combined_Statistic_Total under the same ordering
 * (Req 13.2–13.8, Properties 35 and 36). The result is deterministic for a
 * given input.
 *
 * @returns `{ available: true, awards }` when at least one Player has recorded
 *   regular-season Statistics, otherwise `{ available: false }` (Req 13.16).
 */
export function computeRegularSeasonAwards(
  input: RegularSeasonAwardsInput,
): RegularSeasonAwardsResult {
  const regularSeasonGameIds =
    input.regularSeasonGameIds instanceof Set
      ? input.regularSeasonGameIds
      : new Set(input.regularSeasonGameIds);

  // Req 13.1 / Property 34: accumulate only regular-season-Game Statistics.
  const metricsById = new Map<string, PlayerMetrics>();

  const metricsFor = (playerId: string): PlayerMetrics => {
    let metrics = metricsById.get(playerId);
    if (!metrics) {
      metrics = {
        playerId,
        name: input.playerNameById[playerId] ?? '',
        combinedTotal: 0,
        threePointers: 0,
        defensive: 0,
        assists: 0,
        points: 0,
      };
      metricsById.set(playerId, metrics);
    }
    return metrics;
  };

  for (const stat of input.statistics) {
    if (!regularSeasonGameIds.has(stat.gameId)) {
      continue;
    }
    const metrics = metricsFor(stat.playerId);

    // Every Statistic_Type contributes to the Combined_Statistic_Total.
    metrics.combinedTotal += stat.value;

    switch (stat.type) {
      case 'Points':
        metrics.points += stat.value;
        break;
      case 'Assists':
        metrics.assists += stat.value;
        break;
      case 'Steals':
      case 'Blocks':
        metrics.defensive += stat.value;
        break;
      case 'Three_Pointers_Made':
        metrics.threePointers += stat.value;
        break;
      // 'Rebounds' contributes only to the Combined_Statistic_Total.
    }
  }

  // Req 13.16: no Player has any regular-season Statistic → no Awards.
  if (metricsById.size === 0) {
    return { available: false };
  }

  const players = [...metricsById.values()];

  return {
    available: true,
    awards: {
      mvp: argmax(players, (p) => p.combinedTotal),
      bestIn3Pointers: argmax(players, (p) => p.threePointers),
      dpoy: argmax(players, (p) => p.defensive),
      assistsLeader: argmax(players, (p) => p.assists),
      mythical5: topN(players, (p) => p.combinedTotal, MYTHICAL_5_SIZE),
    },
  };
}

// ---------------------------------------------------------------------------
// Ranking helpers
// ---------------------------------------------------------------------------

/**
 * Compare two Players for a single Award, ordering the higher-ranked Player
 * first. Ranks by the Award `metric` descending, then by the shared tiebreak of
 * higher total Points descending, then ascending Player name (Req 13.7). The
 * final Player-id comparison keeps the order deterministic even when two
 * Players share a name.
 */
function compareByMetric(
  a: PlayerMetrics,
  b: PlayerMetrics,
  metric: (p: PlayerMetrics) => number,
): number {
  const byMetric = metric(b) - metric(a);
  if (byMetric !== 0) {
    return byMetric;
  }
  const byPoints = b.points - a.points;
  if (byPoints !== 0) {
    return byPoints;
  }
  const byName = a.name.localeCompare(b.name);
  if (byName !== 0) {
    return byName;
  }
  return a.playerId.localeCompare(b.playerId);
}

/**
 * Return the Player id maximizing `metric`, breaking ties by higher total
 * Points then ascending name (Req 13.7). Assumes `players` is non-empty.
 */
function argmax(
  players: readonly PlayerMetrics[],
  metric: (p: PlayerMetrics) => number,
): string {
  let best = players[0];
  for (let i = 1; i < players.length; i++) {
    if (compareByMetric(players[i], best, metric) < 0) {
      best = players[i];
    }
  }
  return best.playerId;
}

/**
 * Return the top `n` Player ids ranked by `metric` descending with the standard
 * tiebreak (Req 13.8, Property 36). The full ranking is deterministic, so the
 * tiebreak is applied naturally at the nth-position boundary. Returns fewer than
 * `n` ids only when fewer Players are available.
 */
function topN(
  players: readonly PlayerMetrics[],
  metric: (p: PlayerMetrics) => number,
  n: number,
): string[] {
  const ranked = [...players].sort((a, b) => compareByMetric(a, b, metric));
  return ranked.slice(0, n).map((p) => p.playerId);
}
