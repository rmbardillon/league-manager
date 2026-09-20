/**
 * Pure domain logic for Statistics validation and aggregation (Requirement 8).
 *
 * This module is I/O-free and deterministic so it can be exercised as universal
 * properties (design Properties 18 and 19). It provides:
 *
 *  - {@link validateStatistic}  — enum-type, value-bounds, and player-eligibility
 *    checks for a single Statistic (Req 8.2–8.5).
 *  - {@link aggregateStatistics} — per-Player and per-Team season totals for each
 *    of the six Statistic_Type values, computed as the sum of contributions with
 *    zero for absent types (Req 8.6–8.8).
 *
 * The function does not persist anything; callers (the StatisticsService) are
 * responsible for storing accepted Statistics and rejecting the request when a
 * validation issue is reported, retaining any previously recorded Statistic.
 *
 * _Requirements: 8.2, 8.3, 8.4, 8.5, 8.6, 8.7, 8.8_
 */

import {
  StatisticTypes,
  type Statistic,
  type StatisticType,
} from './types.js';

// ---------------------------------------------------------------------------
// Inclusive bounds for a Statistic value (Req 8.3).
// ---------------------------------------------------------------------------

/** Minimum permitted Statistic value (inclusive). */
export const STATISTIC_VALUE_MIN = 0;

/** Maximum permitted Statistic value (inclusive). */
export const STATISTIC_VALUE_MAX = 999;

// ---------------------------------------------------------------------------
// Validation inputs and result shapes
// ---------------------------------------------------------------------------

/**
 * The minimal Game context needed to decide Player eligibility: the two
 * participating Teams and, for each Player referenced by a Statistic, the Team
 * that Player belongs to.
 */
export interface EligibilityContext {
  /** Home Team of the completed Game. */
  homeTeamId: string;
  /** Away Team of the completed Game. */
  awayTeamId: string;
  /**
   * Maps a Player id to the Team id that Player is rostered on. A Player absent
   * from this map (or mapped to a Team that is neither participant) is not
   * eligible for the Game (Req 8.5).
   */
  playerTeamById: Readonly<Record<string, string>>;
}

/** Reason a single Statistic was rejected during validation. */
export type StatisticRejectionReason =
  | 'invalid_value'
  | 'unsupported_type'
  | 'player_not_eligible';

/** Outcome of validating a single Statistic. */
export type StatisticValidation =
  | { valid: true; statistic: Statistic }
  | { valid: false; statistic: Statistic; reason: StatisticRejectionReason };

// ---------------------------------------------------------------------------
// Single-Statistic validation (Req 8.2–8.5)
// ---------------------------------------------------------------------------

const STATISTIC_TYPE_SET: ReadonlySet<string> = new Set(StatisticTypes);

/**
 * Returns true when `type` is one of the exactly six supported
 * {@link StatisticType} values (Req 8.1, 8.4).
 */
export function isSupportedStatisticType(type: string): type is StatisticType {
  return STATISTIC_TYPE_SET.has(type);
}

/**
 * Returns true when `value` is a non-negative integer within the inclusive
 * range 0–999 (Req 8.3).
 */
export function isValidStatisticValue(value: number): boolean {
  return (
    Number.isInteger(value) &&
    value >= STATISTIC_VALUE_MIN &&
    value <= STATISTIC_VALUE_MAX
  );
}

/**
 * Validates a single Statistic against value bounds, the Statistic_Type enum,
 * and Player eligibility for the completed Game.
 *
 * Order of checks (each independent; the first failure encountered is reported):
 *  1. Unsupported Statistic_Type → `unsupported_type` (Req 8.4).
 *  2. Value negative, non-integer, or outside 0–999 → `invalid_value` (Req 8.3).
 *  3. Player not on either participating Team → `player_not_eligible` (Req 8.5).
 *
 * A valid Statistic (Req 8.2) is returned unchanged so the caller can persist it.
 */
export function validateStatistic(
  statistic: Statistic,
  context: EligibilityContext,
): StatisticValidation {
  if (!isSupportedStatisticType(statistic.type)) {
    return { valid: false, statistic, reason: 'unsupported_type' };
  }

  if (!isValidStatisticValue(statistic.value)) {
    return { valid: false, statistic, reason: 'invalid_value' };
  }

  const playerTeamId = context.playerTeamById[statistic.playerId];
  const eligible =
    playerTeamId === context.homeTeamId ||
    playerTeamId === context.awayTeamId;
  if (!eligible) {
    return { valid: false, statistic, reason: 'player_not_eligible' };
  }

  return { valid: true, statistic };
}

// ---------------------------------------------------------------------------
// Aggregation (Req 8.6–8.8)
// ---------------------------------------------------------------------------

/** Season total for each of the six {@link StatisticType} values. */
export type StatisticTotals = Record<StatisticType, number>;

/** Aggregated season statistics keyed by Player id and by Team id. */
export interface AggregatedStatistics {
  /** Per-Player season totals for each Statistic_Type (zero when none). */
  perPlayer: Record<string, StatisticTotals>;
  /** Per-Team season totals for each Statistic_Type (sum of its Players'). */
  perTeam: Record<string, StatisticTotals>;
}

/** A fresh totals record with every Statistic_Type initialized to zero (Req 8.7). */
export function zeroTotals(): StatisticTotals {
  const totals = {} as StatisticTotals;
  for (const type of StatisticTypes) {
    totals[type] = 0;
  }
  return totals;
}

/**
 * Input describing which Players belong to which Teams for the Season. The
 * aggregation seeds a zero total for every listed Player and Team so that a
 * Player or Team with no recorded Statistics of a type still reports zero for
 * that type (Req 8.7).
 */
export interface RosterContext {
  /** Maps a Player id to the Team id that Player belongs to for the Season. */
  playerTeamById: Readonly<Record<string, string>>;
}

/**
 * Aggregates a set of recorded Statistics into per-Player and per-Team season
 * totals for each of the six Statistic_Type values.
 *
 * Each Player's season total for a type equals the sum of that Player's recorded
 * values of that type, and is zero when the Player has none (Req 8.6, 8.7). Each
 * Team's season total for a type equals the sum of its Players' season totals for
 * that type (Req 8.8).
 *
 * Only Players present in `roster.playerTeamById` contribute to a Team total;
 * a Statistic for an unknown Player is aggregated into that Player's own totals
 * but not attributed to any Team. Callers should validate Statistics with
 * {@link validateStatistic} before aggregating.
 */
export function aggregateStatistics(
  statistics: readonly Statistic[],
  roster: RosterContext,
): AggregatedStatistics {
  const perPlayer: Record<string, StatisticTotals> = {};
  const perTeam: Record<string, StatisticTotals> = {};

  // Seed zero totals for every known Player and Team so absent types report
  // zero (Req 8.7) and rostered-but-statless entities still appear.
  for (const [playerId, teamId] of Object.entries(roster.playerTeamById)) {
    if (!perPlayer[playerId]) {
      perPlayer[playerId] = zeroTotals();
    }
    if (!perTeam[teamId]) {
      perTeam[teamId] = zeroTotals();
    }
  }

  // Accumulate each Statistic into the Player's total, then attribute it to the
  // Player's Team when the Player is rostered.
  for (const stat of statistics) {
    let playerTotals = perPlayer[stat.playerId];
    if (!playerTotals) {
      playerTotals = zeroTotals();
      perPlayer[stat.playerId] = playerTotals;
    }
    playerTotals[stat.type] += stat.value;

    const teamId = roster.playerTeamById[stat.playerId];
    if (teamId !== undefined) {
      let teamTotals = perTeam[teamId];
      if (!teamTotals) {
        teamTotals = zeroTotals();
        perTeam[teamId] = teamTotals;
      }
      teamTotals[stat.type] += stat.value;
    }
  }

  return { perPlayer, perTeam };
}
