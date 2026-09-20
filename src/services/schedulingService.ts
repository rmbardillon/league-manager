/**
 * SchedulingService (manual) — application service for Game scheduling
 * (Requirement 5).
 *
 * Orchestrates the {@link gameRepository}, {@link teamRepository}, and
 * {@link seasonRepository} to create, reschedule, and cancel Games while
 * enforcing the business rules that the data-access layer intentionally omits.
 * Venue overlap detection is delegated to the pure {@link detectVenueConflict}
 * / {@link findVenueConflicts} domain functions.
 *
 * Rules enforced here:
 *   - All required fields present: both Teams, date, start time, duration, and
 *     Venue; a missing field is reported by name (Req 5.2).
 *   - The two Teams must be distinct (Req 5.3).
 *   - Duration must be an integer between 1 and 480 minutes (Req 5.1 / 5.2).
 *   - The scheduled date + start time must be strictly in the future (Req 5.4).
 *   - The Venue interval [start, start + duration) must not overlap any
 *     existing non-cancelled Game at the same Venue; a conflict identifies the
 *     conflicting Game (Req 5.5).
 *   - A reschedule targets a non-cancelled Game (Req 5.7) and re-applies the
 *     future-date (Req 5.4) and conflict (Req 5.5) checks before saving
 *     (Req 5.6).
 *   - Cancelling marks the Game cancelled and retains the record (Req 5.8).
 *
 * Each read-then-write use case runs inside a single {@link withTransaction}
 * unit so the guards and the mutation are atomic; a rejected operation leaves
 * the target data unchanged.
 *
 * _Requirements: 5.1, 5.2, 5.3, 5.4, 5.5, 5.6, 5.7, 5.8_
 */
import { db } from '../db/client.js';
import {
  ConflictError,
  NotFoundError,
  ValidationError,
} from '../domain/errors.js';
import type { Game } from '../domain/types.js';
import { findVenueConflicts } from '../domain/venue.js';
import {
  gameRepository,
  seasonRepository,
  teamRepository,
  withTransaction,
  type Executor,
} from '../repositories/index.js';

const DURATION_MIN_MINUTES = 1;
const DURATION_MAX_MINUTES = 480;

/**
 * Command to create a manual Game (Req 5.1). Every field is required; a
 * `null`/`undefined`/empty value is treated as a missing field (Req 5.2).
 */
export interface CreateGameInput {
  seasonId: string;
  homeTeamId: string;
  awayTeamId: string;
  /** Calendar date of the Game. */
  date: Date;
  /** Local start time as "HH:MM" (24-hour). */
  startTime: string;
  /** Duration in minutes; must be an integer in 1–480. */
  durationMinutes: number;
  /** Physical location. */
  venue: string;
}

/**
 * Command to reschedule an existing non-cancelled Game (Req 5.6). Supplies a
 * new date and start time; the Venue and duration are taken from the existing
 * Game unless overridden here.
 */
export interface RescheduleGameInput {
  date: Date;
  startTime: string;
  /** Optional new duration; defaults to the Game's current duration. */
  durationMinutes?: number;
  /** Optional new Venue; defaults to the Game's current Venue. */
  venue?: string;
}

/** Injectable clock so the future-date rule is deterministic under test. */
export interface SchedulingClock {
  now(): Date;
}

const systemClock: SchedulingClock = { now: () => new Date() };

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
 * Resolve a calendar `date` plus an "HH:MM" `startTime` into an absolute
 * instant, anchoring to the date's local midnight so any time-of-day already
 * carried by `date` is ignored.
 *
 * @throws {ValidationError} when `startTime` is malformed.
 */
function resolveStartInstant(date: Date, startTime: string): Date {
  const minutes = parseStartMinutes(startTime);
  if (minutes === null) {
    throw new ValidationError(
      'Start time must be a valid "HH:MM" 24-hour time.',
      { field: 'startTime' },
    );
  }
  const dayStart = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  dayStart.setMinutes(dayStart.getMinutes() + minutes);
  return dayStart;
}

/**
 * Validate the duration bound: an integer in 1–480 minutes (Req 5.1 / 5.2).
 *
 * @throws {ValidationError} when the duration is not an integer in range.
 */
function assertDuration(durationMinutes: number): void {
  if (
    !Number.isInteger(durationMinutes) ||
    durationMinutes < DURATION_MIN_MINUTES ||
    durationMinutes > DURATION_MAX_MINUTES
  ) {
    throw new ValidationError(
      `Duration must be an integer between ${DURATION_MIN_MINUTES} and ${DURATION_MAX_MINUTES} minutes.`,
      { field: 'durationMinutes' },
    );
  }
}

/**
 * Reject a scheduled date + start time that is not strictly after `now`
 * (Req 5.4).
 *
 * @throws {ValidationError} when the resolved instant is in the past or present.
 */
function assertFuture(startInstant: Date, now: Date): void {
  if (startInstant.getTime() <= now.getTime()) {
    throw new ValidationError(
      'The schedule must be in the future.',
      { field: 'date' },
    );
  }
}

/**
 * Reject a Venue overlap against existing non-cancelled Games in the Season,
 * identifying the conflicting Game (Req 5.5). The candidate is excluded from
 * comparison against itself via its `id`.
 *
 * @throws {ConflictError} when the candidate overlaps at least one Game.
 */
async function assertNoVenueConflict(
  candidate: {
    id?: string;
    date: Date;
    startTime: string;
    durationMinutes: number;
    venue: string;
  },
  seasonId: string,
  ex: Executor,
): Promise<void> {
  const existing = await gameRepository.listBySeason(seasonId, ex);
  const conflicts = findVenueConflicts(candidate, existing);
  if (conflicts.length > 0) {
    const conflicting = conflicts[0]!;
    throw new ConflictError(
      'The Game conflicts with an existing Game at the same Venue.',
      {
        field: 'venue',
        conflictingGameId: conflicting.id,
        conflictingGameIds: conflicts.map((game) => game.id),
      },
    );
  }
}

/**
 * Ensure a Team exists and belongs to the given Season.
 *
 * @throws {NotFoundError} when the Team does not exist in the Season.
 */
async function assertTeamInSeason(
  teamId: string,
  seasonId: string,
  field: string,
  ex: Executor,
): Promise<void> {
  const team = await teamRepository.findById(teamId, ex);
  if (!team || team.seasonId !== seasonId) {
    throw new NotFoundError('Team was not found in this Season.', {
      field,
      teamId,
    });
  }
}

export const schedulingService = {
  /**
   * Create a manual Game between two distinct Teams (Req 5.1).
   *
   * Rejects when any required field is missing (Req 5.2), the two Teams are
   * identical (Req 5.3), the duration is outside 1–480 (Req 5.1 / 5.2), the
   * schedule is not in the future (Req 5.4), or the Venue interval overlaps an
   * existing non-cancelled Game at the same Venue (Req 5.5). No Game is created
   * on any failure.
   */
  async createGame(
    input: CreateGameInput,
    clock: SchedulingClock = systemClock,
  ): Promise<Game> {
    // Missing-field detection, reported by name (Req 5.2).
    assertRequired(input.homeTeamId, 'homeTeamId');
    assertRequired(input.awayTeamId, 'awayTeamId');
    assertRequiredDate(input.date, 'date');
    assertRequired(input.startTime, 'startTime');
    assertRequiredNumber(input.durationMinutes, 'durationMinutes');
    assertRequired(input.venue, 'venue');

    // Distinct Teams (Req 5.3).
    if (input.homeTeamId === input.awayTeamId) {
      throw new ValidationError('The two Teams must be distinct.', {
        field: 'awayTeamId',
      });
    }

    // Duration bound (Req 5.1 / 5.2).
    assertDuration(input.durationMinutes);

    // Future-date rule (Req 5.4).
    const startInstant = resolveStartInstant(input.date, input.startTime);
    assertFuture(startInstant, clock.now());

    const venue = input.venue.trim();

    return withTransaction(db, async (tx) => {
      const season = await seasonRepository.findById(input.seasonId, tx);
      if (!season) {
        throw new NotFoundError('Season was not found.', {
          field: 'seasonId',
          seasonId: input.seasonId,
        });
      }
      await assertTeamInSeason(input.homeTeamId, input.seasonId, 'homeTeamId', tx);
      await assertTeamInSeason(input.awayTeamId, input.seasonId, 'awayTeamId', tx);

      // Venue overlap conflict, identifying the conflicting Game (Req 5.5).
      await assertNoVenueConflict(
        {
          date: input.date,
          startTime: input.startTime,
          durationMinutes: input.durationMinutes,
          venue,
        },
        input.seasonId,
        tx,
      );

      return gameRepository.create(
        {
          seasonId: input.seasonId,
          homeTeamId: input.homeTeamId,
          awayTeamId: input.awayTeamId,
          date: input.date,
          startTime: input.startTime,
          durationMinutes: input.durationMinutes,
          venue,
          status: 'scheduled',
        },
        tx,
      );
    });
  },

  /**
   * Reschedule an existing non-cancelled Game to a new date and start time
   * (Req 5.6).
   *
   * Rejects when the Game does not exist, when it is cancelled (Req 5.7), when
   * the new schedule is not in the future (Req 5.4), or when the new Venue
   * interval overlaps another non-cancelled Game (Req 5.5). The existing
   * schedule is retained unchanged on any failure.
   */
  async rescheduleGame(
    gameId: string,
    input: RescheduleGameInput,
    clock: SchedulingClock = systemClock,
  ): Promise<Game> {
    assertRequiredDate(input.date, 'date');
    assertRequired(input.startTime, 'startTime');

    return withTransaction(db, async (tx) => {
      const existing = await gameRepository.findById(gameId, tx);
      if (!existing) {
        throw new NotFoundError('Game was not found.', { field: 'gameId', gameId });
      }

      // A cancelled Game cannot be rescheduled (Req 5.7).
      if (existing.status === 'cancelled') {
        throw new ValidationError(
          'A cancelled Game cannot be rescheduled.',
          { field: 'status', gameId },
        );
      }

      const durationMinutes = input.durationMinutes ?? existing.durationMinutes;
      if (durationMinutes === null) {
        throw new ValidationError(
          'A duration is required to reschedule the Game.',
          { field: 'durationMinutes' },
        );
      }
      assertDuration(durationMinutes);

      const venue = (input.venue ?? existing.venue ?? '').trim();
      if (venue.length === 0) {
        throw new ValidationError('A Venue is required to reschedule the Game.', {
          field: 'venue',
        });
      }

      // Future-date rule on the new schedule (Req 5.4).
      const startInstant = resolveStartInstant(input.date, input.startTime);
      assertFuture(startInstant, clock.now());

      // Venue overlap conflict against other Games, excluding this one (Req 5.5).
      await assertNoVenueConflict(
        {
          id: gameId,
          date: input.date,
          startTime: input.startTime,
          durationMinutes,
          venue,
        },
        existing.seasonId,
        tx,
      );

      const updated = await gameRepository.update(
        gameId,
        {
          date: input.date,
          startTime: input.startTime,
          durationMinutes,
          venue,
        },
        tx,
      );
      if (!updated) {
        // The row existed at read time; a null here means it vanished mid-txn.
        throw new NotFoundError('Game was not found.', { field: 'gameId', gameId });
      }
      return updated;
    });
  },

  /**
   * Cancel a Game: mark it cancelled, retain the record, and return the updated
   * Game (Req 5.8).
   *
   * @throws {NotFoundError} when the Game does not exist.
   */
  async cancelGame(gameId: string): Promise<Game> {
    return withTransaction(db, async (tx) => {
      const existing = await gameRepository.findById(gameId, tx);
      if (!existing) {
        throw new NotFoundError('Game was not found.', { field: 'gameId', gameId });
      }
      const updated = await gameRepository.setStatus(gameId, 'cancelled', tx);
      if (!updated) {
        throw new NotFoundError('Game was not found.', { field: 'gameId', gameId });
      }
      return updated;
    });
  },
};

/**
 * Reject a missing required string/id field, reported by name (Req 5.2).
 *
 * @throws {ValidationError} when the value is null/undefined or blank.
 */
function assertRequired(value: string | null | undefined, field: string): void {
  if (value === null || value === undefined || value.trim().length === 0) {
    throw new ValidationError(`The required field "${field}" is missing.`, {
      field,
    });
  }
}

/**
 * Reject a missing required numeric field, reported by name (Req 5.2).
 *
 * @throws {ValidationError} when the value is null/undefined or not finite.
 */
function assertRequiredNumber(
  value: number | null | undefined,
  field: string,
): void {
  if (value === null || value === undefined || !Number.isFinite(value)) {
    throw new ValidationError(`The required field "${field}" is missing.`, {
      field,
    });
  }
}

/**
 * Reject a missing required date field, reported by name (Req 5.2).
 *
 * @throws {ValidationError} when the value is null/undefined or an invalid Date.
 */
function assertRequiredDate(value: Date | null | undefined, field: string): void {
  if (
    value === null ||
    value === undefined ||
    !(value instanceof Date) ||
    Number.isNaN(value.getTime())
  ) {
    throw new ValidationError(`The required field "${field}" is missing.`, {
      field,
    });
  }
}
