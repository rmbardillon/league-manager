/**
 * Pure schedule distribution for the Basketball League Management System.
 *
 * This module implements the pure, I/O-free `distributeGames` function
 * described in the design document (Automatic SchedulingService; Properties 29,
 * 30, 31, 33). Given the required Round_Robin matchups and a generation request
 * (date range, selected Playable_Day values, and Games-per-day capacity), it
 * places each matchup onto a valid date without assigning a start time or a
 * Venue, keeping per-Team Game counts as balanced as the matchup set allows and
 * respecting the per-day capacity.
 *
 * Behaviour:
 *   - Every placed matchup lands on a date that is within the date range AND
 *     falls on one of the selected Playable_Day values                (Req 12.9)
 *   - Placed matchups carry no start time and no Venue                (Req 12.10)
 *   - Per-Team Game counts differ by the minimum achievable amount     (Req 12.12)
 *   - At most `gamesPerDay` matchups are placed on any single date     (Req 12.14)
 *   - When the available slots cannot hold every required matchup, the
 *     request is rejected: no matchups are placed and the unplaced
 *     matchups are reported                                           (Req 12.18)
 *
 * The function is deterministic: the same request always yields the same
 * placement. It performs no I/O and never mutates its inputs.
 *
 * NOTE: A local {@link Matchup} input type is defined here on purpose to keep
 * this module decoupled from the wider domain types while another agent works
 * on the round-robin generator in a separate file.
 *
 * _Requirements: 12.9, 12.10, 12.12, 12.14, 12.18_
 */

/**
 * The seven days of the week used for Playable_Day selection, indexed to match
 * JavaScript's `Date.prototype.getUTCDay()` (0 = Sunday … 6 = Saturday).
 */
export type PlayableDay =
  | 'Sunday'
  | 'Monday'
  | 'Tuesday'
  | 'Wednesday'
  | 'Thursday'
  | 'Friday'
  | 'Saturday';

/** Runtime tuple of all {@link PlayableDay} values, indexed by `getUTCDay()`. */
export const PlayableDays = [
  'Sunday',
  'Monday',
  'Tuesday',
  'Wednesday',
  'Thursday',
  'Friday',
  'Saturday',
] as const satisfies readonly PlayableDay[];

/**
 * A single required Round_Robin matchup between two distinct Teams. Defined
 * locally to avoid coupling to the wider domain `Game`/`Team` types; the two
 * team identifiers are the only information distribution needs.
 *
 * `id` is an optional caller-supplied handle (e.g. a matchup index) echoed back
 * on placements and unplaced reports so callers can correlate results.
 */
export interface Matchup {
  /** Optional stable identifier echoed back on the placement / unplaced report. */
  id?: string;
  /** One participating Team. */
  teamAId: string;
  /** The other participating Team; must differ from `teamAId`. */
  teamBId: string;
}

/**
 * Inputs to {@link distributeGames}. Dates are treated as calendar dates in
 * UTC; only the date portion matters for placement and capacity.
 */
export interface DistributeRequest {
  /** The required matchups to place (typically from `roundRobinPairings`). */
  matchups: readonly Matchup[];
  /** Inclusive start of the date range. */
  startDate: Date;
  /** Inclusive end of the date range; must not precede `startDate`. */
  endDate: Date;
  /** The selected Playable_Day values; at least one is required. */
  playableDays: readonly PlayableDay[];
  /** Maximum number of Games placed on each Playable_Day date; must be >= 1. */
  gamesPerDay: number;
}

/**
 * A matchup placed on a specific date, with no start time and no Venue
 * assigned (Req 12.10). `date` is always one of the valid Playable_Day dates
 * within the requested range (Req 12.9).
 */
export interface PlacedGame {
  id?: string;
  teamAId: string;
  teamBId: string;
  /** The assigned calendar date (UTC). */
  date: Date;
  /** Always null for generated draft Games (Req 12.10). */
  startTime: null;
  /** Always null for generated draft Games (Req 12.10). */
  venue: null;
}

/**
 * Result of {@link distributeGames}.
 *
 * When `ok` is true, every matchup was placed and `games` lists the placements.
 * When `ok` is false, capacity was insufficient: `games` is empty (nothing is
 * placed — generation is rejected wholesale per Req 12.18) and `unplaced`
 * reports the matchups that could not be accommodated.
 */
export type DistributeResult =
  | { ok: true; games: PlacedGame[]; unplaced: readonly [] }
  | {
      ok: false;
      games: readonly [];
      unplaced: Matchup[];
      /** Total slots available (validDates × gamesPerDay). */
      availableSlots: number;
      /** Number of matchups that had to be placed. */
      requiredSlots: number;
    };

/**
 * Enumerate every calendar date in `[startDate, endDate]` (inclusive) whose day
 * of week is one of the selected `playableDays`, in ascending chronological
 * order. Dates are normalised to UTC midnight so day-of-week and equality are
 * stable regardless of the input times.
 *
 * Returns an empty array when the range is empty (end precedes start) or no
 * selected day falls within it.
 */
export function validDates(
  startDate: Date,
  endDate: Date,
  playableDays: readonly PlayableDay[],
): Date[] {
  const selected = new Set<number>();
  for (const day of playableDays) {
    const idx = PlayableDays.indexOf(day);
    if (idx >= 0) {
      selected.add(idx);
    }
  }

  const dates: Date[] = [];
  if (selected.size === 0) {
    return dates;
  }

  // Normalise both bounds to UTC midnight and iterate one day at a time.
  const start = Date.UTC(
    startDate.getUTCFullYear(),
    startDate.getUTCMonth(),
    startDate.getUTCDate(),
  );
  const end = Date.UTC(
    endDate.getUTCFullYear(),
    endDate.getUTCMonth(),
    endDate.getUTCDate(),
  );

  const MS_PER_DAY = 24 * 60 * 60 * 1000;
  for (let t = start; t <= end; t += MS_PER_DAY) {
    const d = new Date(t);
    if (selected.has(d.getUTCDay())) {
      dates.push(d);
    }
  }
  return dates;
}

/**
 * Distribute the required Round_Robin matchups across the valid Playable_Day
 * dates within the requested range.
 *
 * Placement strategy: matchups are laid down date-by-date, filling each date up
 * to `gamesPerDay` before moving to the next date, and — within a date — the
 * next matchup preferred is one whose Teams are currently the least scheduled,
 * so that per-Team Game counts stay as balanced as the matchup set allows
 * (Req 12.12). Because a complete Round_Robin gives every Team the same number
 * of matchups, every matchup is placed whenever capacity suffices, so per-Team
 * totals are exactly balanced.
 *
 * Capacity is the number of valid dates multiplied by `gamesPerDay`. When the
 * required matchups exceed that capacity the whole generation is rejected: no
 * Games are placed and the surplus matchups are reported as unplaced
 * (Req 12.18).
 *
 * The function does not validate the request beyond capacity (input validation
 * — end-before-start, empty Playable_Day selection, gamesPerDay < 1, fewer than
 * two Teams — is the calling service's responsibility, Req 12.3–12.6). Given a
 * non-positive `gamesPerDay` or an empty date range, capacity is zero and any
 * matchups are reported as unplaced.
 *
 * @returns A {@link DistributeResult}; `ok: true` with placements on success,
 *   or `ok: false` with the unplaced matchups when capacity is insufficient.
 */
export function distributeGames(request: DistributeRequest): DistributeResult {
  const { matchups, startDate, endDate, playableDays, gamesPerDay } = request;

  const dates = validDates(startDate, endDate, playableDays);
  const perDay = Number.isFinite(gamesPerDay) ? Math.floor(gamesPerDay) : 0;
  const capacityPerDay = perDay > 0 ? perDay : 0;
  const availableSlots = dates.length * capacityPerDay;
  const requiredSlots = matchups.length;

  // Insufficient capacity → reject wholesale and report every matchup as
  // unplaced (Req 12.18). Nothing is placed.
  if (requiredSlots > availableSlots) {
    return {
      ok: false,
      games: [],
      unplaced: matchups.slice(),
      availableSlots,
      requiredSlots,
    };
  }

  // Enough capacity: place every matchup. Track how many Games each Team has
  // been assigned so we can prefer the least-scheduled Teams and keep counts
  // balanced (Req 12.12). Track how many Games sit on each date to honour the
  // per-day cap (Req 12.14).
  const teamCounts = new Map<string, number>();
  const bump = (teamId: string): void => {
    teamCounts.set(teamId, (teamCounts.get(teamId) ?? 0) + 1);
  };
  const pairLoad = (m: Matchup): number =>
    (teamCounts.get(m.teamAId) ?? 0) + (teamCounts.get(m.teamBId) ?? 0);

  // Work on a mutable copy so inputs are never mutated.
  const remaining = matchups.slice();
  const games: PlacedGame[] = [];

  for (const date of dates) {
    if (remaining.length === 0) {
      break;
    }
    for (let placedToday = 0; placedToday < capacityPerDay; placedToday++) {
      if (remaining.length === 0) {
        break;
      }
      // Pick the remaining matchup whose two Teams are currently the least
      // scheduled. Ties resolve to the earliest such matchup for determinism.
      let bestIdx = 0;
      let bestLoad = pairLoad(remaining[0]!);
      for (let i = 1; i < remaining.length; i++) {
        const load = pairLoad(remaining[i]!);
        if (load < bestLoad) {
          bestLoad = load;
          bestIdx = i;
        }
      }

      const [chosen] = remaining.splice(bestIdx, 1) as [Matchup];
      bump(chosen.teamAId);
      bump(chosen.teamBId);

      const placed: PlacedGame = {
        teamAId: chosen.teamAId,
        teamBId: chosen.teamBId,
        date: new Date(date.getTime()),
        startTime: null,
        venue: null,
      };
      if (chosen.id !== undefined) {
        placed.id = chosen.id;
      }
      games.push(placed);
    }
  }

  return { ok: true, games, unplaced: [] };
}
