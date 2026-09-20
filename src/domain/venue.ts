/**
 * Pure venue conflict detection for the Basketball League Management System.
 *
 * This module implements the pure, I/O-free `detectVenueConflict` function
 * described in the design document (SchedulingService, Property 11). A candidate
 * Game conflicts with the existing schedule if and only if its half-open time
 * interval [start, start + duration) overlaps the interval of at least one
 * existing non-cancelled Game AT THE SAME Venue (Req 5.5).
 *
 * Interval semantics are HALF-OPEN: a candidate that begins exactly when an
 * existing Game ends (or ends exactly when an existing Game begins) does NOT
 * conflict. Two intervals [aStart, aEnd) and [bStart, bEnd) overlap iff
 * aStart < bEnd AND bStart < aEnd.
 *
 * Only the Venue matters for a conflict: Games at different Venues never
 * conflict, and cancelled Games are ignored entirely (Req 5.5).
 *
 * _Requirements: 5.5_
 */

import type { Game } from './types.js';

/**
 * The minimal shape needed to place a candidate Game on the timeline. Callers
 * may pass a full {@link Game} or a lightweight object with just the scheduling
 * fields. `venue`, `startTime`, and `durationMinutes` must all be present for a
 * candidate to be schedulable; a candidate missing any of them cannot occupy a
 * concrete interval and therefore never conflicts.
 */
export interface VenueCandidate {
  /** Excluded from conflict comparison against itself, when provided. */
  id?: string;
  /** The calendar date of the Game. Combined with `startTime` to form an instant. */
  date: Date;
  /** Local start time as "HH:MM" (24-hour). null → not schedulable. */
  startTime: string | null;
  /** Duration in minutes (1–480). null → not schedulable. */
  durationMinutes: number | null;
  /** Physical location. null → not schedulable. */
  venue: string | null;
}

/** A resolved half-open interval on the absolute timeline, in milliseconds. */
interface Interval {
  start: number;
  end: number;
}

const MINUTE_MS = 60_000;

/**
 * Determine whether `candidate` conflicts with any Game in `existingGames`.
 *
 * A conflict exists if and only if the candidate is fully schedulable (has a
 * Venue, a start time, and a positive duration) AND there is at least one
 * existing Game that:
 *   1. is not cancelled (`status !== 'cancelled'`),
 *   2. is at the same Venue (exact string match),
 *   3. is itself fully schedulable, and
 *   4. has an interval overlapping the candidate's under half-open semantics.
 *
 * The candidate itself is excluded from comparison when it carries an `id` that
 * matches an existing Game (so re-checking an already-scheduled Game against the
 * full schedule does not report a self-conflict).
 *
 * @param candidate The Game being scheduled or rescheduled.
 * @param existingGames The current set of Games to check against.
 * @returns `true` iff the candidate overlaps at least one non-cancelled Game at
 *   the same Venue.
 */
export function detectVenueConflict(
  candidate: VenueCandidate,
  existingGames: readonly Game[],
): boolean {
  return findVenueConflicts(candidate, existingGames).length > 0;
}

/**
 * Like {@link detectVenueConflict}, but returns every existing non-cancelled
 * Game whose interval overlaps the candidate at the same Venue. Useful for
 * building a conflict error that identifies the conflicting Game(s) (Req 5.5).
 *
 * @returns The overlapping Games in the order they appear in `existingGames`;
 *   an empty array when there is no conflict.
 */
export function findVenueConflicts(
  candidate: VenueCandidate,
  existingGames: readonly Game[],
): Game[] {
  const candidateInterval = toInterval(candidate);
  if (candidateInterval === null || candidate.venue === null) {
    // A candidate that cannot occupy a concrete interval never conflicts.
    return [];
  }

  const conflicts: Game[] = [];
  for (const game of existingGames) {
    // Never compare the candidate against itself.
    if (candidate.id !== undefined && game.id === candidate.id) {
      continue;
    }
    // Cancelled Games do not occupy the Venue (Req 5.5).
    if (game.status === 'cancelled') {
      continue;
    }
    // Only Games at the same Venue can conflict.
    if (game.venue === null || game.venue !== candidate.venue) {
      continue;
    }
    const gameInterval = toInterval(game);
    if (gameInterval === null) {
      continue;
    }
    if (intervalsOverlap(candidateInterval, gameInterval)) {
      conflicts.push(game);
    }
  }
  return conflicts;
}

/**
 * Resolve a schedulable Game into an absolute half-open interval, or `null` when
 * the Game lacks the fields required to occupy a concrete interval (no start
 * time, no positive duration). The `date` supplies the calendar day and the
 * "HH:MM" `startTime` supplies the local wall-clock offset within that day.
 */
function toInterval(game: VenueCandidate): Interval | null {
  if (game.startTime === null || game.durationMinutes === null) {
    return null;
  }
  if (!Number.isFinite(game.durationMinutes) || game.durationMinutes <= 0) {
    return null;
  }
  const minutesFromMidnight = parseStartMinutes(game.startTime);
  if (minutesFromMidnight === null) {
    return null;
  }

  // Anchor to the calendar date's midnight and add the wall-clock offset, so
  // the comparison is independent of any time-of-day already carried by `date`.
  const dayStart = new Date(
    game.date.getFullYear(),
    game.date.getMonth(),
    game.date.getDate(),
  ).getTime();
  const start = dayStart + minutesFromMidnight * MINUTE_MS;
  const end = start + game.durationMinutes * MINUTE_MS;
  return { start, end };
}

/**
 * Parse an "HH:MM" 24-hour time string into minutes from midnight, or `null`
 * when the string is malformed or out of range (hours 0–23, minutes 0–59).
 */
function parseStartMinutes(startTime: string): number | null {
  const match = /^(\d{1,2}):(\d{2})$/.exec(startTime.trim());
  if (match === null) {
    return null;
  }
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (hours < 0 || hours > 23 || minutes < 0 || minutes > 59) {
    return null;
  }
  return hours * 60 + minutes;
}

/**
 * Half-open interval overlap: [aStart, aEnd) overlaps [bStart, bEnd) iff
 * aStart < bEnd AND bStart < aEnd. Touching endpoints do not overlap.
 */
function intervalsOverlap(a: Interval, b: Interval): boolean {
  return a.start < b.end && b.start < a.end;
}
