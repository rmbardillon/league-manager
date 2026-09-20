/**
 * Pure round-robin schedule generation for the Basketball League Management
 * System.
 *
 * This module implements the pure, I/O-free `roundRobinPairings` function
 * described in the design document (automatic SchedulingService, Property 28).
 * It produces the complete set of required matchups for a Round_Robin
 * competition, independent of dates, venues, or Game placement (those concerns
 * belong to `distributeGames`).
 *
 * For n ≥ 2 Teams and a Round_Robin kind k (1 for single, 2 for double), the
 * result contains every unordered pair of distinct Teams exactly k times and no
 * other matchups, giving k · n · (n − 1) / 2 matchups total (Req 12.7, 12.8;
 * Property 28). The same input always produces the same output.
 *
 * _Requirements: 12.7, 12.8_
 */

import type { Team } from './types.js';

/**
 * The number of times each unordered pair of Teams meets in a Round_Robin.
 *
 * - `1` — single Round_Robin: each pair plays exactly once (Req 12.7).
 * - `2` — double Round_Robin: each pair plays exactly twice (Req 12.8).
 */
export type RoundRobinKind = 1 | 2;

/**
 * An unordered pairing of two distinct Teams that must play a Game.
 *
 * A Matchup carries no date, start time, or Venue: it is the pure "who plays
 * whom" produced by {@link roundRobinPairings}, to be placed onto the schedule
 * by a later step. The two Team ids are always distinct.
 */
export interface Matchup {
  teamAId: string;
  teamBId: string;
}

/**
 * Generate the complete set of Round_Robin matchups for a set of Teams.
 *
 * Every unordered pair of distinct Teams appears exactly `kind` times and no
 * other matchups are produced, yielding `kind · n · (n − 1) / 2` matchups for
 * `n` Teams (Req 12.7, 12.8; Property 28). The output is deterministic: pairs
 * are emitted in the input Team order (each Team paired with every later Team),
 * and duplicate rounds for a double Round_Robin are appended after the first.
 *
 * @param teams The Teams to schedule. At least two distinct Teams are required.
 *   The input order determines the deterministic ordering of the output.
 * @param kind `1` for a single Round_Robin, `2` for a double Round_Robin.
 * @returns The required matchups. For each Matchup, `teamAId` precedes
 *   `teamBId` in the input Team order.
 * @throws {RangeError} If fewer than two Teams are supplied, if any Team id is
 *   duplicated, or if `kind` is not 1 or 2.
 */
export function roundRobinPairings(
  teams: readonly Team[],
  kind: RoundRobinKind,
): Matchup[] {
  if (teams.length < 2) {
    throw new RangeError('round-robin requires at least two Teams');
  }
  if (kind !== 1 && kind !== 2) {
    throw new RangeError('round-robin kind must be 1 (single) or 2 (double)');
  }

  const seen = new Set<string>();
  for (const team of teams) {
    if (seen.has(team.id)) {
      throw new RangeError(`duplicate Team id in round-robin input: ${team.id}`);
    }
    seen.add(team.id);
  }

  // Build the base set of every unordered pair exactly once, in input order:
  // team[i] paired with team[j] for every j > i.
  const basePairs: Matchup[] = [];
  for (let i = 0; i < teams.length; i++) {
    for (let j = i + 1; j < teams.length; j++) {
      basePairs.push({ teamAId: teams[i]!.id, teamBId: teams[j]!.id });
    }
  }

  // Repeat the base set `kind` times so each pair appears exactly `kind` times.
  const matchups: Matchup[] = [];
  for (let round = 0; round < kind; round++) {
    for (const pair of basePairs) {
      matchups.push({ teamAId: pair.teamAId, teamBId: pair.teamBId });
    }
  }

  return matchups;
}
