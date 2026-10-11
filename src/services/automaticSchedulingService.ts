/**
 * Automatic SchedulingService — draft Round_Robin schedule generation
 * (Requirement 12).
 *
 * Orchestrates the pure {@link roundRobinPairings} and {@link distributeGames}
 * domain functions with the Repository Layer to produce, refine, and publish an
 * automatically generated schedule following the draft-then-submit workflow.
 *
 * Responsibilities:
 * - `generateSchedule`   — Administrator-only (Req 12.1). Validates the
 *                          generation inputs (Req 12.3–12.6), builds the
 *                          required matchups with `roundRobinPairings`, places
 *                          them with `distributeGames`, and persists the
 *                          placements as a Draft_Schedule — `scheduleState`
 *                          `'draft'`, no start time, no Venue (Req 12.10, 12.15).
 *                          Rejects with a {@link CapacityError} when the range,
 *                          Playable_Day selection, and per-day capacity cannot
 *                          hold every matchup, reporting the unplaced matchups
 *                          (Req 12.18).
 * - `regenerateSchedule` — Administrator-only. Deletes the current draft Games
 *                          for the scope and generates a fresh Draft_Schedule
 *                          (Req 12.16).
 * - `assignVenueAndTime` — Administrator-only. Assigns a Venue and start time to
 *                          a draft Game while it is still in draft state
 *                          (Req 12.11), rejecting a Venue overlap against the
 *                          Season's non-cancelled Games (Req 5.5, reused here).
 * - `submitDraftSchedule`— Administrator-only. Flips every draft Game for the
 *                          scope to `'official'` so it becomes visible to
 *                          Viewers (Req 12.17).
 *
 * Each read-then-write use case runs inside a single {@link withTransaction}
 * unit so the guards and the mutation are atomic; a rejected operation leaves
 * the target data unchanged and generates no Games (Req 12.3–12.6, 12.18).
 *
 * _Requirements: 12.1, 12.2, 12.3, 12.4, 12.5, 12.6, 12.11, 12.15, 12.16, 12.17_
 */
import { authorize, type AuthUser } from '../domain/authorize.js';
import {
  distributeGames,
  type Matchup as DistributeMatchup,
  type PlayableDay,
} from '../domain/distribute.js';
import {
  AuthorizationError,
  CapacityError,
  ConflictError,
  NotFoundError,
  ValidationError,
} from '../domain/errors.js';
import { roundRobinPairings, type RoundRobinKind } from '../domain/schedule.js';
import type { Game } from '../domain/types.js';
import { findVenueConflicts } from '../domain/venue.js';
import type { Database, Executor } from '../repositories/executor.js';
import { withTransaction } from '../repositories/executor.js';
import {
  gameRepository,
  seasonRepository,
  teamRepository,
} from '../repositories/index.js';

// ---------------------------------------------------------------------------
// Command shapes
// ---------------------------------------------------------------------------

/**
 * Inputs accepted for automatic schedule generation (Req 12.2): a date range,
 * the selected Playable_Day values, the Round_Robin format (single/double), and
 * the number of Games permitted per Playable_Day.
 */
export interface GenerateScheduleCommand {
  /** The Season to schedule; its Teams supply the Round_Robin field. */
  seasonId: string;
  /** Inclusive start of the date range. */
  startDate: Date;
  /** Inclusive end of the date range; must not precede `startDate` (Req 12.3). */
  endDate: Date;
  /** Selected Playable_Day values; at least one required (Req 12.4). */
  playableDays: readonly PlayableDay[];
  /** Round_Robin format: single (each pair once) or double (each pair twice). */
  roundRobinKind: 'single' | 'double';
  /** Maximum Games placed on each Playable_Day date; must be >= 1 (Req 12.5). */
  gamesPerDay: number;
}

/** Input for {@link AutomaticSchedulingService.assignVenueAndTime} (Req 12.11). */
export interface AssignVenueAndTimeCommand {
  /** The draft Game to schedule. */
  gameId: string;
  /** Physical location to assign. */
  venue: string;
  /** Local start time as "HH:MM" (24-hour) to assign. */
  startTime: string;
  /** Duration in minutes (1–480); defaults to 60 when the draft has none. */
  durationMinutes?: number;
}

/**
 * Input for editing a draft Game's matchup and/or date (manual draft edits).
 * Every field is optional; only the provided fields are changed. Lets a
 * commissioner's hand-drafted schedule be adjusted: swap home/away Teams,
 * change either Team, or move the matchup to a different date. Venue and
 * start time are managed separately via assignVenueAndTime.
 */
export interface EditDraftGameCommand {
  gameId: string;
  /** New calendar date for the Game. */
  date?: Date;
  /** New home Team id. */
  homeTeamId?: string;
  /** New away Team id. */
  awayTeamId?: string;
}

const DEFAULT_DURATION_MINUTES = 60;
const DURATION_MIN_MINUTES = 1;
const DURATION_MAX_MINUTES = 480;

// ---------------------------------------------------------------------------
// Pure input helpers
// ---------------------------------------------------------------------------

/** Map the single/double selection onto the pure {@link RoundRobinKind}. */
function toRoundRobinKind(kind: 'single' | 'double'): RoundRobinKind {
  return kind === 'double' ? 2 : 1;
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

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

/**
 * Application service for automatic (Round_Robin) schedule generation.
 * Construct it with a {@link Database} handle; each method opens its own
 * transaction so the validate/authorize-then-persist flow is atomic and
 * non-mutating on failure.
 */
export class AutomaticSchedulingService {
  constructor(private readonly db: Database) {}

  /**
   * Generate a draft Round_Robin schedule for a Season (Req 12.2, 12.15).
   *
   * Only an Administrator may generate; any other principal is denied before
   * any read or write (Req 12.1). Validates the generation inputs and generates
   * no Games on any failure (Req 12.3–12.6):
   *   - the end date must not precede the start date (Req 12.3),
   *   - at least one Playable_Day must be selected (Req 12.4),
   *   - the number of Games per Playable_Day must be at least 1 (Req 12.5),
   *   - the Season must have at least two Teams (Req 12.6).
   *
   * The required matchups come from {@link roundRobinPairings} and are placed by
   * {@link distributeGames}. When capacity cannot hold every matchup the whole
   * generation is rejected with a {@link CapacityError} carrying the unplaced
   * matchups; nothing is persisted (Req 12.18). On success the placements are
   * stored as draft Games with no start time and no Venue (Req 12.10, 12.15).
   *
   * @throws AuthorizationError when the caller is not an Administrator (Req 12.1).
   * @throws NotFoundError      when the Season does not exist.
   * @throws ValidationError    when an input is invalid (Req 12.3–12.6).
   * @throws CapacityError      when capacity is insufficient (Req 12.18).
   */
  async generateSchedule(
    user: AuthUser,
    command: GenerateScheduleCommand,
  ): Promise<Game[]> {
    // Req 12.1: automatic schedule generation requires Administrator privileges.
    this.assertAdmin(user);

    // Req 12.3: the end date must not precede the start date.
    if (command.endDate.getTime() < command.startDate.getTime()) {
      throw new ValidationError('The end date must not precede the start date.', {
        field: 'endDate',
      });
    }

    // Req 12.4: at least one Playable_Day must be selected.
    if (command.playableDays.length === 0) {
      throw new ValidationError('At least one Playable_Day must be selected.', {
        field: 'playableDays',
      });
    }

    // Req 12.5: the number of Games per Playable_Day must be at least 1.
    if (
      !Number.isInteger(command.gamesPerDay) ||
      command.gamesPerDay < 1
    ) {
      throw new ValidationError(
        'The number of Games per Playable_Day must be at least 1.',
        { field: 'gamesPerDay' },
      );
    }

    return withTransaction(this.db, async (tx) => {
      const season = await seasonRepository.findById(command.seasonId, tx);
      if (!season) {
        throw new NotFoundError('The specified Season does not exist.', {
          field: 'seasonId',
          seasonId: command.seasonId,
        });
      }

      const teams = await teamRepository.listBySeason(command.seasonId, tx);

      // Req 12.6: the Season must have at least two Teams.
      if (teams.length < 2) {
        throw new ValidationError(
          'At least two Teams are required to generate a schedule.',
          { field: 'seasonId', teamCount: teams.length },
        );
      }

      return this.placeAndPersist(command, teams, tx);
    });
  }

  /**
   * Re-generate the Draft_Schedule for a Season (Req 12.16).
   *
   * Administrator-only (Req 12.1). Deletes the existing draft Games for the
   * Season and then generates a fresh Draft_Schedule with the supplied inputs.
   * Official Games are never touched. Input validation and capacity handling
   * mirror {@link generateSchedule}; on any failure the transaction rolls back
   * and the existing draft is left unchanged.
   *
   * @throws AuthorizationError when the caller is not an Administrator (Req 12.1).
   * @throws NotFoundError      when the Season does not exist.
   * @throws ValidationError    when an input is invalid (Req 12.3–12.6).
   * @throws CapacityError      when capacity is insufficient (Req 12.18).
   */
  async regenerateSchedule(
    user: AuthUser,
    command: GenerateScheduleCommand,
  ): Promise<Game[]> {
    this.assertAdmin(user);

    if (command.endDate.getTime() < command.startDate.getTime()) {
      throw new ValidationError('The end date must not precede the start date.', {
        field: 'endDate',
      });
    }
    if (command.playableDays.length === 0) {
      throw new ValidationError('At least one Playable_Day must be selected.', {
        field: 'playableDays',
      });
    }
    if (!Number.isInteger(command.gamesPerDay) || command.gamesPerDay < 1) {
      throw new ValidationError(
        'The number of Games per Playable_Day must be at least 1.',
        { field: 'gamesPerDay' },
      );
    }

    return withTransaction(this.db, async (tx) => {
      const season = await seasonRepository.findById(command.seasonId, tx);
      if (!season) {
        throw new NotFoundError('The specified Season does not exist.', {
          field: 'seasonId',
          seasonId: command.seasonId,
        });
      }

      const teams = await teamRepository.listBySeason(command.seasonId, tx);
      if (teams.length < 2) {
        throw new ValidationError(
          'At least two Teams are required to generate a schedule.',
          { field: 'seasonId', teamCount: teams.length },
        );
      }

      // Remove the current draft before generating a fresh one (Req 12.16).
      // Official Games are preserved.
      const existing = await gameRepository.listBySeason(command.seasonId, tx);
      for (const game of existing) {
        if (game.scheduleState === 'draft') {
          await gameRepository.delete(game.id, tx);
        }
      }

      return this.placeAndPersist(command, teams, tx);
    });
  }

  /**
   * Assign a Venue and start time to a single draft Game (Req 12.11).
   *
   * Administrator-only (Req 12.1). The Game must exist and still be in draft
   * state; assigning to an official Game is rejected. The assignment is rejected
   * when it would overlap a non-cancelled Game at the same Venue in the Season
   * (Req 5.5). On success the Game keeps its draft state — it becomes visible
   * only after {@link submitDraftSchedule}.
   *
   * @throws AuthorizationError when the caller is not an Administrator (Req 12.1).
   * @throws NotFoundError      when the Game does not exist.
   * @throws ValidationError    when the Game is not a draft or an input is invalid.
   * @throws ConflictError      when the assignment overlaps an existing Game.
   */
  async assignVenueAndTime(
    user: AuthUser,
    command: AssignVenueAndTimeCommand,
  ): Promise<Game> {
    this.assertAdmin(user);

    const venue = command.venue?.trim() ?? '';
    if (venue.length === 0) {
      throw new ValidationError('A Venue is required.', { field: 'venue' });
    }
    if (parseStartMinutes(command.startTime) === null) {
      throw new ValidationError(
        'Start time must be a valid "HH:MM" 24-hour time.',
        { field: 'startTime' },
      );
    }

    const durationMinutes = command.durationMinutes ?? DEFAULT_DURATION_MINUTES;
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

    return withTransaction(this.db, async (tx) => {
      const game = await gameRepository.findById(command.gameId, tx);
      if (!game) {
        throw new NotFoundError('Game was not found.', {
          field: 'gameId',
          gameId: command.gameId,
        });
      }

      // Assignment is only permitted while the schedule is in draft state
      // (Req 12.11).
      if (game.scheduleState !== 'draft') {
        throw new ValidationError(
          'Only a draft Game can have its Venue and start time assigned.',
          { field: 'scheduleState', gameId: command.gameId },
        );
      }

      // Venue overlap against the Season's non-cancelled Games, excluding this
      // Game itself (Req 5.5).
      const existing = await gameRepository.listBySeason(game.seasonId, tx);
      const conflicts = findVenueConflicts(
        {
          id: game.id,
          date: game.date,
          startTime: command.startTime,
          durationMinutes,
          venue,
        },
        existing,
      );
      if (conflicts.length > 0) {
        throw new ConflictError(
          'The Game conflicts with an existing Game at the same Venue.',
          {
            field: 'venue',
            conflictingGameId: conflicts[0]!.id,
            conflictingGameIds: conflicts.map((c) => c.id),
          },
        );
      }

      const updated = await gameRepository.update(
        command.gameId,
        { startTime: command.startTime, durationMinutes, venue },
        tx,
      );
      if (!updated) {
        throw new NotFoundError('Game was not found.', {
          field: 'gameId',
          gameId: command.gameId,
        });
      }
      return updated;
    });
  }

  /**
   * Edit a draft Game's matchup and/or date (manual draft adjustment).
   *
   * Administrator-only. The Game must exist and still be in draft state; an
   * official Game is never edited this way. Supplied Team ids are validated to
   * be distinct and to belong to the Game's Season. A date-only edit moves the
   * matchup; swapping both Team ids switches home and away. Only provided
   * fields change; Venue and start time are left untouched.
   */
  async editDraftGame(
    user: AuthUser,
    command: EditDraftGameCommand,
  ): Promise<Game> {
    this.assertAdmin(user);

    return withTransaction(this.db, async (tx) => {
      const game = await gameRepository.findById(command.gameId, tx);
      if (!game) {
        throw new NotFoundError('Game was not found.', {
          field: 'gameId',
          gameId: command.gameId,
        });
      }
      // A played (completed) Game cannot be rewritten - changing its teams or
      // date would invalidate the recorded Score, Standings, and Statistics.
      // A cancelled Game is likewise not editable. Draft and official-but-
      // still-scheduled Games may both be edited (date and matchup).
      if (game.status === 'completed') {
        throw new ValidationError(
          'A completed Game cannot be edited; correct its score instead.',
          { field: 'status', gameId: command.gameId },
        );
      }
      if (game.status === 'cancelled') {
        throw new ValidationError('A cancelled Game cannot be edited.', {
          field: 'status',
          gameId: command.gameId,
        });
      }

      const nextHome = command.homeTeamId ?? game.homeTeamId;
      const nextAway = command.awayTeamId ?? game.awayTeamId;
      if (nextHome === nextAway) {
        throw new ValidationError('The two Teams must be distinct.', {
          field: 'awayTeamId',
        });
      }

      const teams = await teamRepository.listBySeason(game.seasonId, tx);
      const inSeason = new Set(teams.map((team) => team.id));
      if (command.homeTeamId !== undefined && !inSeason.has(nextHome)) {
        throw new NotFoundError('Team was not found in this Season.', {
          field: 'homeTeamId',
          teamId: nextHome,
        });
      }
      if (command.awayTeamId !== undefined && !inSeason.has(nextAway)) {
        throw new NotFoundError('Team was not found in this Season.', {
          field: 'awayTeamId',
          teamId: nextAway,
        });
      }

      const patch: { date?: Date; homeTeamId?: string; awayTeamId?: string } = {};
      if (command.date !== undefined) patch.date = command.date;
      if (command.homeTeamId !== undefined) patch.homeTeamId = nextHome;
      if (command.awayTeamId !== undefined) patch.awayTeamId = nextAway;

      const updated = await gameRepository.update(command.gameId, patch, tx);
      if (!updated) {
        throw new NotFoundError('Game was not found.', {
          field: 'gameId',
          gameId: command.gameId,
        });
      }
      return updated;
    });
  }

  /**
   * Submit the Draft_Schedule for a Season (Req 12.17).
   *
   * Administrator-only (Req 12.1). Every draft Game for the Season is converted
   * to `scheduleState` `'official'`, making it visible to Viewers. Games already
   * official are left unchanged. Returns the Games that were promoted.
   *
   * @throws AuthorizationError when the caller is not an Administrator (Req 12.1).
   * @throws NotFoundError      when the Season does not exist.
   */
  async submitDraftSchedule(
    user: AuthUser,
    seasonId: string,
  ): Promise<Game[]> {
    this.assertAdmin(user);

    return withTransaction(this.db, async (tx) => {
      const season = await seasonRepository.findById(seasonId, tx);
      if (!season) {
        throw new NotFoundError('The specified Season does not exist.', {
          field: 'seasonId',
          seasonId,
        });
      }

      const existing = await gameRepository.listBySeason(seasonId, tx);
      const promoted: Game[] = [];
      for (const game of existing) {
        if (game.scheduleState !== 'draft') {
          continue;
        }
        const updated = await gameRepository.update(
          game.id,
          { scheduleState: 'official' },
          tx,
        );
        if (updated) {
          promoted.push(updated);
        }
      }
      return promoted;
    });
  }

  // -------------------------------------------------------------------------
  // Internal helpers
  // -------------------------------------------------------------------------

  /**
   * Enforce that the acting principal is an Administrator for any automatic
   * scheduling operation (Req 12.1). The pure `authorize` function denies every
   * non-Administrator for a `schedule-generation` resource.
   *
   * @throws AuthorizationError when the decision is a denial.
   */
  private assertAdmin(user: AuthUser): void {
    const decision = authorize(user, 'create', { kind: 'schedule-generation' });
    if (!decision.allowed) {
      throw new AuthorizationError(decision.reason);
    }
  }

  /**
   * Build the required matchups, place them, and persist the placements as a
   * Draft_Schedule. Shared by {@link generateSchedule} and
   * {@link regenerateSchedule}. Runs entirely within the caller's transaction
   * so a {@link CapacityError} rolls back any prior writes (e.g. draft deletion
   * during regeneration).
   *
   * @throws CapacityError when capacity cannot hold every matchup (Req 12.18).
   */
  private async placeAndPersist(
    command: GenerateScheduleCommand,
    teams: readonly { id: string; seasonId: string; name: string }[],
    tx: Executor,
  ): Promise<Game[]> {
    // Round_Robin matchups (Req 12.7, 12.8). `roundRobinPairings` requires the
    // wider Team shape; the fields it reads (`id`) are present here.
    const matchups = roundRobinPairings(teams, toRoundRobinKind(command.roundRobinKind));

    const distributeMatchups: DistributeMatchup[] = matchups.map((m, index) => ({
      id: String(index),
      teamAId: m.teamAId,
      teamBId: m.teamBId,
    }));

    const result = distributeGames({
      matchups: distributeMatchups,
      startDate: command.startDate,
      endDate: command.endDate,
      playableDays: command.playableDays,
      gamesPerDay: command.gamesPerDay,
    });

    // Req 12.18: insufficient capacity → reject wholesale, report unplaced.
    if (!result.ok) {
      throw new CapacityError(
        'The schedule cannot accommodate all required matchups; scheduling capacity is insufficient.',
        {
          unplaced: result.unplaced.map((m) => ({
            teamAId: m.teamAId,
            teamBId: m.teamBId,
          })),
          availableSlots: result.availableSlots,
          requiredSlots: result.requiredSlots,
        },
      );
    }

    // Persist as a Draft_Schedule: no start time, no Venue, draft state
    // (Req 12.10, 12.15).
    const created = await gameRepository.createMany(
      result.games.map((placed) => ({
        seasonId: command.seasonId,
        homeTeamId: placed.teamAId,
        awayTeamId: placed.teamBId,
        date: placed.date,
        startTime: null,
        durationMinutes: null,
        venue: null,
        status: 'scheduled' as const,
        scheduleState: 'draft' as const,
        playoffRoundId: null,
        seriesId: null,
      })),
      tx,
    );
    return created;
  }
}

/**
 * Convenience factory mirroring the other services: build an
 * {@link AutomaticSchedulingService} bound to a {@link Database} handle.
 */
export function createAutomaticSchedulingService(
  db: Database,
): AutomaticSchedulingService {
  return new AutomaticSchedulingService(db);
}
