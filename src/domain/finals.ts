/**
 * Pure Finals MVP computation for the AwardsService (Requirement 13).
 *
 * The Finals MVP is the standout Player on the Series-winning champion Team
 * across the Finals. Unlike the regular-season stat-based Awards, it is derived
 * from playoff Statistics and its candidate pool is restricted to the champion
 * Team's roster. This module exposes that selection as a pure, I/O-free,
 * deterministic function so it can be property-tested in isolation
 * (design Property 37) and reused by the service layer.
 *
 * Selection rules (Requirement 13):
 * - Req 13.9: the candidate pool is restricted to Players on the Series-winning
 *   champion Team; the winner is the Player with the highest Total_Statistics_Points
 *   (TSP) across all completed Finals Games.
 * - Req 13.10: ties on Finals TSP are broken by recomputing TSP across all
 *   playoff Games of every Playoff_Round (the "full-playoffs" TSP), ranking the
 *   higher full-playoffs TSP higher.
 * - Req 13.11: a remaining tie is broken by the higher total Points across all
 *   playoff Games, and finally by ascending alphabetical Player name.
 * - Req 13.12: when there are no completed Finals Games, no Finals MVP is
 *   computed and an "unavailable" indication is returned.
 *
 * Total_Statistics_Points (TSP) intentionally EXCLUDES Three_Pointers_Made:
 * TSP = Points + Assists + Rebounds + Steals + Blocks.
 *
 * The function performs no I/O and mutates none of its arguments.
 *
 * _Requirements: 13.9, 13.10, 13.11_
 */

import type { Statistic } from './types.js';

/**
 * The Statistic_Type values that contribute to Total_Statistics_Points.
 * Note the deliberate exclusion of `Three_Pointers_Made` (see module docs).
 */
const TSP_STATISTIC_TYPES = [
  'Points',
  'Assists',
  'Rebounds',
  'Steals',
  'Blocks',
] as const;

const TSP_TYPE_SET: ReadonlySet<string> = new Set(TSP_STATISTIC_TYPES);

/**
 * A Player eligible for Finals MVP consideration, i.e. a member of the
 * champion Team's roster. The `name` is used only for the final alphabetical
 * tiebreak (Req 13.11).
 */
export interface FinalsCandidate {
  /** Player id, matching {@link Statistic.playerId}. */
  playerId: string;
  /** Player name, used for the ascending alphabetical tiebreak (Req 13.11). */
  name: string;
}

/**
 * Inputs to {@link computeFinalsMvp}. All Statistics supplied should already be
 * restricted to playoff Games; the caller separates Finals Statistics from the
 * remaining playoff Statistics so this pure function can compute both the
 * Finals TSP metric and the full-playoffs tiebreak metric without any I/O.
 */
export interface FinalsMvpInput {
  /**
   * Players on the Series-winning champion Team. The candidate pool is
   * restricted to exactly these Players (Req 13.9).
   */
  championTeamPlayers: readonly FinalsCandidate[];
  /**
   * Statistics recorded in completed Finals Games. Statistics for Players not
   * on the champion Team are ignored. An empty list means no completed Finals
   * Games contributed statistics.
   */
  finalsStatistics: readonly Statistic[];
  /**
   * Statistics recorded across ALL completed playoff Games of every
   * Playoff_Round (including the Finals). Used for the full-playoffs TSP
   * tiebreak (Req 13.10) and the total-playoff-Points tiebreak (Req 13.11).
   */
  allPlayoffStatistics: readonly Statistic[];
  /**
   * Whether the Season/Tournament has at least one completed Finals Game. When
   * false, no Finals MVP is computed (Req 13.12). Defaults to true when
   * omitted, in which case the presence of Finals Statistics is the only
   * availability signal.
   */
  hasCompletedFinals?: boolean;
}

/** Outcome of a Finals MVP computation. */
export type FinalsMvpResult =
  | { readonly available: true; readonly playerId: string }
  | { readonly available: false; readonly reason: 'no_completed_finals' };

/** Per-Player metric tallies used to rank Finals MVP candidates. */
interface CandidateMetrics {
  readonly candidate: FinalsCandidate;
  /** TSP across the Finals Games (primary metric, Req 13.9). */
  finalsTsp: number;
  /** TSP across all playoff Games (first tiebreak, Req 13.10). */
  fullPlayoffTsp: number;
  /** Total Points across all playoff Games (second tiebreak, Req 13.11). */
  fullPlayoffPoints: number;
}

/**
 * Sums a Player's Total_Statistics_Points contribution from a single Statistic,
 * counting only the five TSP-contributing types (excludes Three_Pointers_Made).
 */
function tspContribution(stat: Statistic): number {
  return TSP_TYPE_SET.has(stat.type) ? stat.value : 0;
}

/**
 * Compute the Finals MVP for a Season or Tournament.
 *
 * The candidate pool is restricted to the champion Team's Players (Req 13.9).
 * Candidates are ranked by, in order: Finals TSP descending (Req 13.9),
 * full-playoffs TSP descending (Req 13.10), total playoff Points descending
 * (Req 13.11), then ascending Player name (Req 13.11). The ordering is total
 * and deterministic — the alphabetical name tiebreak resolves any remaining
 * tie (Player names within a Team roster are distinct).
 *
 * @param input See {@link FinalsMvpInput}.
 * @returns The champion-Team Player id maximizing the metric, or an
 *   `available: false` indication when there are no completed Finals Games
 *   (Req 13.12) or the champion Team has no candidate Players.
 */
export function computeFinalsMvp(input: FinalsMvpInput): FinalsMvpResult {
  const {
    championTeamPlayers,
    finalsStatistics,
    allPlayoffStatistics,
    hasCompletedFinals,
  } = input;

  // Req 13.12: no completed Finals Games → no Finals MVP. Availability is
  // signalled explicitly when provided, otherwise inferred from whether any
  // Finals Statistics exist.
  const finalsCompleted =
    hasCompletedFinals ?? finalsStatistics.length > 0;
  if (!finalsCompleted) {
    return { available: false, reason: 'no_completed_finals' };
  }

  // Req 13.9: restrict the candidate pool to the champion Team's roster. With
  // no candidates there is no Player to award.
  if (championTeamPlayers.length === 0) {
    return { available: false, reason: 'no_completed_finals' };
  }

  // Seed a zero-metric entry for every candidate so a Player with no recorded
  // playoff Statistics is still considered (and can win via the tiebreaks).
  const metricsByPlayer = new Map<string, CandidateMetrics>();
  for (const candidate of championTeamPlayers) {
    if (!metricsByPlayer.has(candidate.playerId)) {
      metricsByPlayer.set(candidate.playerId, {
        candidate,
        finalsTsp: 0,
        fullPlayoffTsp: 0,
        fullPlayoffPoints: 0,
      });
    }
  }

  // Req 13.9: accumulate Finals TSP for candidate Players only.
  for (const stat of finalsStatistics) {
    const metrics = metricsByPlayer.get(stat.playerId);
    if (metrics === undefined) {
      continue;
    }
    metrics.finalsTsp += tspContribution(stat);
  }

  // Req 13.10 / 13.11: accumulate full-playoffs TSP and total playoff Points
  // for candidate Players only.
  for (const stat of allPlayoffStatistics) {
    const metrics = metricsByPlayer.get(stat.playerId);
    if (metrics === undefined) {
      continue;
    }
    metrics.fullPlayoffTsp += tspContribution(stat);
    if (stat.type === 'Points') {
      metrics.fullPlayoffPoints += stat.value;
    }
  }

  // Select the maximum under the full comparator. A single pass keeps the
  // running best; `compareCandidates` returns a negative value when its first
  // argument ranks higher (should win).
  let best: CandidateMetrics | undefined;
  for (const metrics of metricsByPlayer.values()) {
    if (best === undefined || compareCandidates(metrics, best) < 0) {
      best = metrics;
    }
  }

  // `best` is defined because championTeamPlayers is non-empty.
  return { available: true, playerId: best!.candidate.playerId };
}

/**
 * Total ordering over Finals MVP candidates. Returns a negative number when `a`
 * ranks strictly higher than `b` (i.e. `a` should be selected over `b`), a
 * positive number when `b` ranks higher, and 0 only when the two are the same
 * candidate.
 *
 * Ordering (highest-ranked first):
 *  1. Higher Finals TSP (Req 13.9).
 *  2. Higher full-playoffs TSP (Req 13.10).
 *  3. Higher total playoff Points (Req 13.11).
 *  4. Ascending Player name (Req 13.11).
 */
function compareCandidates(a: CandidateMetrics, b: CandidateMetrics): number {
  if (a.finalsTsp !== b.finalsTsp) {
    return b.finalsTsp - a.finalsTsp;
  }
  if (a.fullPlayoffTsp !== b.fullPlayoffTsp) {
    return b.fullPlayoffTsp - a.fullPlayoffTsp;
  }
  if (a.fullPlayoffPoints !== b.fullPlayoffPoints) {
    return b.fullPlayoffPoints - a.fullPlayoffPoints;
  }
  const byName = a.candidate.name.localeCompare(b.candidate.name);
  if (byName !== 0) {
    return byName;
  }
  // Final, fully deterministic disambiguation by Player id (names within a
  // roster are distinct, so this is a safety net only).
  return a.candidate.playerId.localeCompare(b.candidate.playerId);
}
