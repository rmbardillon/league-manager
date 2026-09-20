/**
 * SeasonTournamentService — Season and Tournament management (Requirement 9).
 *
 * Orchestrates the Season/Tournament/Playoff use cases by validating the
 * business rules in the pure domain vocabulary and then persisting through the
 * Repository Layer. All multi-read/write flows run inside a single transaction
 * so a rejected operation leaves the target data unchanged.
 *
 * Responsibilities:
 * - `createSeason`      — name length 1–100, name unique within the League, and
 *                         endDate strictly after startDate (Req 9.1, 9.2, 9.3).
 * - `createTournament`  — format restricted to single-elimination,
 *                         double-elimination, or round-robin; round-robin kind
 *                         support (Req 9.4, 9.5, 9.6).
 * - `createPlayoffGame` — playoff Games are created manually (no bracket
 *                         auto-generation), each attached to exactly one
 *                         Playoff_Round of Quarterfinals/Semifinals/Finals and
 *                         an optional best-of-N Series; rejected in a closed
 *                         Season (Req 9.7, 9.8, 9.9, 9.13).
 * - `createSeries`      — best-of-N restricted to 1, 3, 5, or 7 (Req 9.10, 9.11).
 * - `closeSeason`       — mark the Season closed and persist its final
 *                         Standings snapshot; afterwards new Games are rejected
 *                         (Req 9.13).
 *
 * The winner of a Series (Req 9.12) is derived by the pure `resolveSeries`
 * function in src/domain/series.ts and is not persisted state here.
 *
 * _Requirements: 9.1, 9.2, 9.3, 9.4, 9.5, 9.6, 9.7, 9.8, 9.13_
 */
import type {
  BestOfN,
  Game,
  Season,
  Series,
  StandingRow,
  TournamentFormat,
} from '../domain/types.js';
import { BestOfNValues, TournamentFormats } from '../domain/types.js';
import { ConflictError, ConstraintError, NotFoundError, ValidationError } from '../domain/errors.js';
import type { Database } from '../repositories/executor.js';
import { withTransaction } from '../repositories/executor.js';
import {
  gameRepository,
  leagueRepository,
  playoffRoundRepository,
  seasonRepository,
  seriesRepository,
  tournamentRepository,
} from '../repositories/index.js';

// ---------------------------------------------------------------------------
// Command shapes
// ---------------------------------------------------------------------------

/** Input for {@link SeasonTournamentService.createSeason}. */
export interface CreateSeasonCommand {
  leagueId: string;
  name: string;
  startDate: Date;
  endDate: Date;
}

/** Input for {@link SeasonTournamentService.createTournament}. */
export interface CreateTournamentCommand {
  seasonId: string;
  format: TournamentFormat;
  /** Required when `format` is `round-robin`; ignored otherwise (Req 9.6). */
  roundRobinKind?: 'single' | 'double';
}

/**
 * Input for {@link SeasonTournamentService.createPlayoffGame}.
 *
 * A playoff Game is always attached to exactly one Playoff_Round (Req 9.8, 9.9)
 * and may optionally belong to a best-of-N Series (Req 9.7).
 */
export interface CreatePlayoffGameCommand {
  seasonId: string;
  homeTeamId: string;
  awayTeamId: string;
  date: Date;
  /** Stored as 'HH:MM'; may be null for a not-yet-scheduled playoff Game. */
  startTime?: string | null;
  /** 1–480 minutes; may be null when unscheduled. */
  durationMinutes?: number | null;
  venue?: string | null;
  /** The Playoff_Round this Game belongs to (Req 9.9). */
  playoffRoundId: string;
  /** Optional Series within the Playoff_Round (Req 9.7). */
  seriesId?: string | null;
}

/** Input for {@link SeasonTournamentService.createSeries}. */
export interface CreateSeriesCommand {
  playoffRoundId: string;
  teamAId: string;
  teamBId: string;
  /** Must be 1, 3, 5, or 7 (Req 9.10, 9.11). */
  bestOf: number;
}

// ---------------------------------------------------------------------------
// Validation helpers (pure)
// ---------------------------------------------------------------------------

const NAME_MIN = 1;
const NAME_MAX = 100;

/** True when `name` is a string of length within 1–100 after no trimming. */
function isValidName(name: unknown): name is string {
  return typeof name === 'string' && name.length >= NAME_MIN && name.length <= NAME_MAX;
}

function isTournamentFormat(format: string): format is TournamentFormat {
  return (TournamentFormats as readonly string[]).includes(format);
}

function isValidBestOf(bestOf: number): bestOf is BestOfN {
  return (BestOfNValues as readonly number[]).includes(bestOf);
}

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

/**
 * Application service for Season and Tournament management. Construct it with a
 * {@link Database} handle; each method opens its own transaction so the
 * validate-then-persist flow is atomic and non-mutating on failure.
 */
export class SeasonTournamentService {
  constructor(private readonly db: Database) {}

  /**
   * Create a Season within a League (Req 9.1).
   *
   * Rejects and creates nothing when the name length is outside 1–100 or
   * duplicates an existing Season name (case-insensitive) within the same
   * League (Req 9.3), or when the end date is the same as or precedes the start
   * date (Req 9.2).
   *
   * @throws NotFoundError   if the League does not exist.
   * @throws ValidationError if the name length or date ordering is invalid.
   * @throws ConflictError   if the name duplicates an existing Season name in
   *   the League.
   */
  async createSeason(cmd: CreateSeasonCommand): Promise<Season> {
    // Req 9.3: name length 1–100.
    if (!isValidName(cmd.name)) {
      throw new ValidationError(
        'The Season name must be between 1 and 100 characters.',
        { field: 'name' },
      );
    }

    // Req 9.2: end date must be strictly after the start date.
    if (cmd.endDate.getTime() <= cmd.startDate.getTime()) {
      throw new ValidationError('The end date must be after the start date.', {
        field: 'endDate',
      });
    }

    return withTransaction(this.db, async (tx) => {
      const league = await leagueRepository.findById(cmd.leagueId, tx);
      if (!league) {
        throw new NotFoundError('The specified League does not exist.', {
          leagueId: cmd.leagueId,
        });
      }

      // Req 9.3: name unique (case-insensitive) within the League.
      const existing = await seasonRepository.listByLeague(cmd.leagueId, tx);
      const target = cmd.name.toLowerCase();
      if (existing.some((s) => s.name.toLowerCase() === target)) {
        throw new ConflictError(
          'A Season with this name already exists in the League.',
          { field: 'name' },
        );
      }

      return seasonRepository.create(
        {
          leagueId: cmd.leagueId,
          name: cmd.name,
          startDate: cmd.startDate,
          endDate: cmd.endDate,
        },
        tx,
      );
    });
  }

  /**
   * Create a Tournament within a Season (Req 9.4).
   *
   * Rejects and creates nothing when the format is not one of
   * single-elimination, double-elimination, or round-robin (Req 9.5). For a
   * round-robin format the single/double kind is recorded (Req 9.6).
   *
   * @throws NotFoundError   if the Season does not exist.
   * @throws ValidationError if the format is unsupported or a round-robin kind
   *   is missing/invalid.
   */
  async createTournament(cmd: CreateTournamentCommand) {
    // Req 9.5: format must be one of the supported values.
    if (!isTournamentFormat(cmd.format)) {
      throw new ValidationError('The Tournament format is not supported.', {
        field: 'format',
      });
    }

    // Req 9.6: a round-robin Tournament must specify single or double.
    let roundRobinKind: 'single' | 'double' | undefined;
    if (cmd.format === 'round-robin') {
      if (cmd.roundRobinKind !== 'single' && cmd.roundRobinKind !== 'double') {
        throw new ValidationError(
          'A round-robin Tournament requires a Round_Robin kind of single or double.',
          { field: 'roundRobinKind' },
        );
      }
      roundRobinKind = cmd.roundRobinKind;
    }

    return withTransaction(this.db, async (tx) => {
      const season = await seasonRepository.findById(cmd.seasonId, tx);
      if (!season) {
        throw new NotFoundError('The specified Season does not exist.', {
          seasonId: cmd.seasonId,
        });
      }

      return tournamentRepository.create(
        {
          seasonId: cmd.seasonId,
          format: cmd.format,
          ...(roundRobinKind !== undefined ? { roundRobinKind } : {}),
        },
        tx,
      );
    });
  }

  /**
   * Create a playoff Game manually (Req 9.7). Playoff brackets are never
   * auto-generated; each playoff Game is attached to exactly one Playoff_Round
   * (Req 9.8) of Quarterfinals, Semifinals, or Finals (Req 9.9), and may
   * optionally belong to a Series within that Round (Req 9.7).
   *
   * Rejected when the Season is closed (Req 9.13).
   *
   * @throws NotFoundError   if the Season, Playoff_Round, or Series does not
   *   exist.
   * @throws ValidationError if the two Teams are identical.
   * @throws ConstraintError if the Season is closed.
   */
  async createPlayoffGame(cmd: CreatePlayoffGameCommand): Promise<Game> {
    // Req 9.8 (classification): playoff Games must reference a Playoff_Round.
    if (!cmd.playoffRoundId) {
      throw new ValidationError(
        'A playoff Game must be associated with a Playoff_Round.',
        { field: 'playoffRoundId' },
      );
    }

    // Distinct teams (mirrors the schema constraint; validated before persist).
    if (cmd.homeTeamId === cmd.awayTeamId) {
      throw new ValidationError('A Game must be between two distinct Teams.', {
        field: 'awayTeamId',
      });
    }

    return withTransaction(this.db, async (tx) => {
      const season = await seasonRepository.findById(cmd.seasonId, tx);
      if (!season) {
        throw new NotFoundError('The specified Season does not exist.', {
          seasonId: cmd.seasonId,
        });
      }

      // Req 9.13: a closed Season rejects new Games.
      if (season.closed) {
        throw new ConstraintError(
          'The Season is closed; no new Games can be created within it.',
          { seasonId: cmd.seasonId },
        );
      }

      // Req 9.9: the Playoff_Round must exist and belong to this Season.
      const round = await playoffRoundRepository.findById(cmd.playoffRoundId, tx);
      if (!round || round.seasonId !== cmd.seasonId) {
        throw new NotFoundError(
          'The specified Playoff_Round does not exist in this Season.',
          { playoffRoundId: cmd.playoffRoundId },
        );
      }

      // Req 9.7: an optional Series must exist within the given Playoff_Round.
      if (cmd.seriesId) {
        const series = await seriesRepository.findById(cmd.seriesId, tx);
        if (!series || series.playoffRoundId !== cmd.playoffRoundId) {
          throw new NotFoundError(
            'The specified Series does not exist in this Playoff_Round.',
            { seriesId: cmd.seriesId },
          );
        }
      }

      // Req 9.8: attach exactly one Playoff_Round; never regular-season here.
      return gameRepository.create(
        {
          seasonId: cmd.seasonId,
          homeTeamId: cmd.homeTeamId,
          awayTeamId: cmd.awayTeamId,
          date: cmd.date,
          startTime: cmd.startTime ?? null,
          durationMinutes: cmd.durationMinutes ?? null,
          venue: cmd.venue ?? null,
          status: 'scheduled',
          scheduleState: 'official',
          playoffRoundId: cmd.playoffRoundId,
          seriesId: cmd.seriesId ?? null,
        },
        tx,
      );
    });
  }

  /**
   * Create a best-of-N Series within a Playoff_Round (Req 9.10).
   *
   * Rejects and creates nothing when the best-of-N value is not 1, 3, 5, or 7
   * (Req 9.11), or when the two Teams are identical.
   *
   * @throws NotFoundError   if the Playoff_Round does not exist.
   * @throws ValidationError if best-of-N is unsupported or the Teams are equal.
   */
  async createSeries(cmd: CreateSeriesCommand): Promise<Series> {
    // Req 9.11: best-of-N must be one of {1, 3, 5, 7}.
    if (!isValidBestOf(cmd.bestOf)) {
      throw new ValidationError(
        'The best-of-N format is not supported; it must be best-of-1, best-of-3, best-of-5, or best-of-7.',
        { field: 'bestOf' },
      );
    }

    // A Series is contested between two distinct Teams.
    if (cmd.teamAId === cmd.teamBId) {
      throw new ValidationError('A Series must be between two distinct Teams.', {
        field: 'teamBId',
      });
    }

    const bestOf: BestOfN = cmd.bestOf;

    return withTransaction(this.db, async (tx) => {
      const round = await playoffRoundRepository.findById(cmd.playoffRoundId, tx);
      if (!round) {
        throw new NotFoundError('The specified Playoff_Round does not exist.', {
          playoffRoundId: cmd.playoffRoundId,
        });
      }

      return seriesRepository.create(
        {
          playoffRoundId: cmd.playoffRoundId,
          teamAId: cmd.teamAId,
          teamBId: cmd.teamBId,
          bestOf,
        },
        tx,
      );
    });
  }

  /**
   * Mark a Season closed and persist its final Standings snapshot (Req 10.5).
   * After closing, playoff/regular Game creation within the Season is rejected
   * (Req 9.13).
   *
   * @param seasonId The Season to close.
   * @param finalStandings The snapshot to record as the Season's final
   *   Standings.
   * @throws NotFoundError if the Season does not exist.
   */
  async closeSeason(seasonId: string, finalStandings: StandingRow[]): Promise<Season> {
    return withTransaction(this.db, async (tx) => {
      const season = await seasonRepository.findById(seasonId, tx);
      if (!season) {
        throw new NotFoundError('The specified Season does not exist.', { seasonId });
      }

      const closed = await seasonRepository.close(seasonId, finalStandings, tx);
      // The Season existed a line above and is updated within the same
      // transaction, so `close` returns the updated row.
      if (!closed) {
        throw new NotFoundError('The specified Season does not exist.', { seasonId });
      }
      return closed;
    });
  }
}

/**
 * Convenience factory mirroring the pattern used by the other services: build a
 * {@link SeasonTournamentService} bound to a {@link Database} handle.
 */
export function createSeasonTournamentService(db: Database): SeasonTournamentService {
  return new SeasonTournamentService(db);
}

// Re-exported so callers can compose a playoff Series winner without importing
// the domain module directly (Req 9.12 is resolved by the pure function).
export { resolveSeries } from '../domain/series.js';
