/**
 * Wire types for the Basketball League Management REST API.
 *
 * These interfaces mirror the JSON payloads produced by the backend
 * controllers (see `src/api/routes/*.ts`) and the shared domain entities
 * (see `src/domain/types.ts`). They are duplicated here (rather than imported
 * across the workspace boundary) so the web bundle stays decoupled from the
 * backend's Node-only modules and its `Date` objects — every date crosses the
 * wire as an ISO string.
 */

// ---------------------------------------------------------------------------
// Enums / string-literal unions (mirror src/domain/types.ts)
// ---------------------------------------------------------------------------

export type Role = 'Administrator' | 'Team_Manager' | 'Viewer';

export type AwardCategory =
  | 'MVP'
  | 'Mythical_5'
  | 'Best_in_3_Pointers'
  | 'DPOY'
  | 'Assists_Leader'
  | 'Finals_MVP';

/** Tournament formats (mirror src/domain/types.ts). */
export type TournamentFormat =
  | 'single-elimination'
  | 'double-elimination'
  | 'round-robin';

/** Round-robin schedule kind, required when the format is round-robin. */
export type RoundRobinKind = 'single' | 'double';

/** Playoff round types (mirror src/domain/types.ts). */
export type PlayoffRoundType = 'Quarterfinals' | 'Semifinals' | 'Finals';

/** Best-of series length. */
export type BestOf = 1 | 3 | 5 | 7;

// ---------------------------------------------------------------------------
// Auth
// ---------------------------------------------------------------------------

/**
 * The authenticated principal returned by `GET /auth/me` and `POST /auth/signin`.
 * `role` is null for a User with no assigned role (Req 2.5).
 */
export interface AuthUser {
  userId: string;
  username: string;
  role: Role | null;
  /** Teams a Team_Manager is assigned to (Req 4.4). */
  managedTeamIds: string[];
}

export interface SignInRequest {
  username: string;
  password: string;
}

// ---------------------------------------------------------------------------
// List-read summaries (mirror the authenticated list endpoints)
// ---------------------------------------------------------------------------

/** One row of `GET /leagues` (Req 1.1). */
export interface LeagueSummary {
  id: string;
  name: string;
}

/**
 * One row of `GET /leagues/:leagueId/seasons` (Req 1.2).
 * Dates cross the wire as ISO date strings (YYYY-MM-DD).
 */
export interface SeasonSummary {
  id: string;
  name: string;
  /** ISO date (YYYY-MM-DD). */
  startDate: string;
  /** ISO date (YYYY-MM-DD). */
  endDate: string;
  closed: boolean;
}

/** One row of `GET /seasons/:seasonId/teams` (Req 2.1). */
export interface TeamSummary {
  id: string;
  name: string;
}

/** One row of `GET /seasons/:seasonId/tournaments` (Req 2.3). */
export interface TournamentSummary {
  id: string;
  format: TournamentFormat;
  roundRobinKind?: RoundRobinKind;
}

/** One row of `GET /seasons/:seasonId/playoff-rounds` (Req 9 selectors). */
export interface PlayoffRoundSummary {
  id: string;
  type: PlayoffRoundType;
}

/** One row of `GET /playoff-rounds/:roundId/series` (Req 9 series selector). */
export interface SeriesSummary {
  id: string;
  teamAId: string;
  teamBId: string;
  bestOf: BestOf;
}

// ---------------------------------------------------------------------------
// Teams (mutating management)
// ---------------------------------------------------------------------------

export interface Team {
  id: string;
  seasonId: string;
  name: string;
}

export interface CreateTeamRequest {
  seasonId: string;
  name: string;
}

export interface UpdateTeamRequest {
  name: string;
}

// ---------------------------------------------------------------------------
// Master Players / Roster + assignments
//
// Mirrors the shapes the `player-master-data` routes already serve. A master
// Player is a league-wide person record (`GET /players`); a RosterEntry is a
// Player's membership on one Team (`GET /teams/:teamId/roster`); a
// RosterAssignment is the response of the assignment mutations.
// ---------------------------------------------------------------------------

/** Master Player — league-wide person record (`GET /players`). */
export interface Player {
  id: string;
  name: string;
}

/** A Player's membership on a Team (`GET /teams/:teamId/roster`). */
export interface RosterEntry {
  playerId: string;
  name: string;
  jerseyNumber: number;
}

/** Response of the assignment mutations (`POST`/`PATCH` on assignments). */
export interface RosterAssignment {
  id: string;
  playerId: string;
  teamId: string;
  jerseyNumber: number;
}

/** `POST /players` — register a new master Player. */
export interface CreatePlayerRequest {
  name: string;
}

/** One entry of a master Player's assignment history (GET /players/:id/history). */
export interface PlayerHistoryEntry {
  assignmentId: string;
  teamId: string;
  seasonId: string;
  jerseyNumber: number;
}

/** `PATCH /players/:playerId` - rename a master Player. */
export interface UpdatePlayerRequest {
  name: string;
}

/** `POST /seasons/:seasonId/batch-upload` - import Teams + Players from a file. */
export interface BatchUploadRequest {
  /** The uploaded file bytes, base64-encoded. */
  fileBase64: string;
  /** Original filename (its extension drives CSV/.xlsx detection). */
  filename: string;
  /** MIME type reported by the browser, if any. */
  mimeType?: string;
}

/** Confirmation returned by a successful Batch_Upload. */
export interface BatchUploadResult {
  teamsCreated: number;
  playersCreated: number;
  importedRecords: number;
}

/** `POST /teams/:teamId/assignments` — assign a master Player to a Team. */
export interface AssignPlayerRequest {
  playerId: string;
  jerseyNumber: number;
}

/** `PATCH /teams/:teamId/assignments/:playerId` — change a jersey number. */
export interface UpdateJerseyRequest {
  jerseyNumber: number;
}

// ---------------------------------------------------------------------------
// UI-driven create requests (new typed wire shapes)
// ---------------------------------------------------------------------------

/** `POST /seasons` (Req 4.2). Dates as ISO date strings. */
export interface CreateSeasonRequest {
  leagueId: string;
  name: string;
  /** ISO date (YYYY-MM-DD). */
  startDate: string;
  /** ISO date (YYYY-MM-DD). */
  endDate: string;
}

/** `POST /seasons/:seasonId/tournaments` (Req 8.2). */
export interface CreateTournamentRequest {
  format: TournamentFormat;
  roundRobinKind?: RoundRobinKind;
}

/** `POST /seasons/:seasonId/playoff-rounds` (Req 9.2). */
export interface CreatePlayoffRoundRequest {
  type: PlayoffRoundType;
}

/** `POST /playoff-rounds/:roundId/series` (Req 9.4). */
export interface CreateSeriesRequest {
  teamAId: string;
  teamBId: string;
  bestOf: BestOf;
}

/** `POST /seasons/:seasonId/playoff-games` (Req 9.6). Date as an ISO date string. */
export interface CreatePlayoffGameRequest {
  homeTeamId: string;
  awayTeamId: string;
  /** ISO date (YYYY-MM-DD). */
  date: string;
  startTime?: string | null;
  durationMinutes?: number | null;
  venue?: string | null;
  playoffRoundId: string;
  seriesId?: string | null;
}

// ---------------------------------------------------------------------------
// Public browsing payloads (mirror src/api/routes/public.ts)
// ---------------------------------------------------------------------------

/** One row of the public schedule (Req 10.1). */
export interface ScheduleEntry {
  gameId: string;
  /** ISO date (YYYY-MM-DD). */
  date: string;
  startTime: string | null;
  venue: string | null;
  homeTeamId: string;
  homeTeamName: string;
  awayTeamId: string;
  awayTeamName: string;
}

export interface SchedulePayload {
  seasonId: string;
  games: ScheduleEntry[];
  message?: string;
}

/** One row of the public results view (Req 10.3). */
export interface ResultEntry {
  gameId: string;
  homeTeamId: string;
  homeTeamName: string;
  awayTeamId: string;
  awayTeamName: string;
  homeScore: number;
  awayScore: number;
  /** ISO timestamp. */
  completedAt: string;
}

export interface ResultsPayload {
  seasonId: string;
  games: ResultEntry[];
  message?: string;
}

/** One row of the public Standings view (Req 10.4). */
export interface StandingEntry {
  rank: number;
  teamId: string;
  teamName: string;
  wins: number;
  losses: number;
}

export interface StandingsPayload {
  seasonId: string;
  closed: boolean;
  standings: StandingEntry[];
  message?: string;
}

/**
 * Field-limited public projection of a Season (`GET /public/seasons`, Req 7.4).
 * Deliberately omits management-only fields (`leagueId`, `startDate`,
 * `endDate`, `finalStandingsSnapshot`) (Req 7.6).
 */
export interface PublicSeasonSummary {
  id: string;
  name: string;
  closed: boolean;
}

/** Seasons available for public browsing; empty → `{ seasons: [], message }` (Req 7.5). */
export interface PublicSeasonsPayload {
  seasons: PublicSeasonSummary[];
  message?: string;
}

// ---------------------------------------------------------------------------
// Awards (published, public read — Req 13.15)
// ---------------------------------------------------------------------------

export interface Award {
  id: string;
  scopeId: string;
  category: AwardCategory;
  /** One Player for most Awards; five for Mythical 5. */
  playerIds: string[];
  published: boolean;
}

/**
 * Published Awards for a scope (Season/Tournament). Viewers see exactly the
 * published subset (Req 13.14, 13.15).
 */
export interface PublishedAwardsPayload {
  scopeId: string;
  awards: Award[];
  message?: string;
}

// ---------------------------------------------------------------------------
// Error wire shape (mirror src/domain/errors.ts)
// ---------------------------------------------------------------------------

export type ErrorCategory =
  | 'ValidationError'
  | 'AuthenticationError'
  | 'AccountLockedError'
  | 'AuthorizationError'
  | 'NotFoundError'
  | 'ConflictError'
  | 'ConstraintError'
  | 'CapacityError'
  | 'BatchValidationError';

/** The consistent error envelope `{ error: { category, message, details? } }`. */
export interface ApiErrorResponse {
  error: {
    category: ErrorCategory;
    message: string;
    details?: unknown;
  };
}

// ---------------------------------------------------------------------------
// Games (management reads + manual scheduling) - Req 5, 12
// ---------------------------------------------------------------------------

export type GameStatus = 'scheduled' | 'completed' | 'cancelled';
export type ScheduleState = 'draft' | 'official';

/** One Game of a Season for the management views (GET /seasons/:id/games). */
export interface GameSummary {
  id: string;
  /** ISO date-time string. */
  date: string;
  startTime: string | null;
  durationMinutes: number | null;
  venue: string | null;
  status: GameStatus;
  scheduleState: ScheduleState;
  homeTeamId: string;
  homeTeamName: string;
  awayTeamId: string;
  awayTeamName: string;
  playoffRoundId: string | null;
  seriesId: string | null;
  homeScore: number | null;
  awayScore: number | null;
}

/** A single Game's full record (GET /games/:gameId). */
export type GameDetail = GameSummary;

/** `POST /games` - create a manual regular-season Game (Req 5.1). */
export interface CreateGameRequest {
  seasonId: string;
  homeTeamId: string;
  awayTeamId: string;
  /** ISO date (YYYY-MM-DD). */
  date: string;
  /** "HH:MM" 24-hour local start time. */
  startTime: string;
  /** 1-480 minutes. */
  durationMinutes: number;
  venue: string;
}

/** `PATCH /games/:gameId` - reschedule a non-cancelled Game (Req 5.6). */
export interface RescheduleGameRequest {
  /** ISO date (YYYY-MM-DD). */
  date: string;
  startTime: string;
  durationMinutes?: number;
  venue?: string;
}

// ---------------------------------------------------------------------------
// Scores (record / correct / read) - Req 6
// ---------------------------------------------------------------------------

/** `POST /games/:gameId/score` and `/score/correct` - 0-999 integers. */
export interface RecordScoreRequest {
  homeScore: number;
  awayScore: number;
}

/** The stored Score of a Game. */
export interface ScorePayload {
  gameId: string;
  homeScore: number;
  awayScore: number;
  /** ISO timestamp. */
  completedAt: string;
}

// ---------------------------------------------------------------------------
// Automatic schedule generation - Req 12
// ---------------------------------------------------------------------------

export type PlayableDay =
  | 'Monday'
  | 'Tuesday'
  | 'Wednesday'
  | 'Thursday'
  | 'Friday'
  | 'Saturday'
  | 'Sunday';

/** `POST /seasons/:id/schedule/generate` and `/regenerate` (Req 12.2). */
export interface GenerateScheduleRequest {
  /** ISO date (YYYY-MM-DD). */
  startDate: string;
  /** ISO date (YYYY-MM-DD). */
  endDate: string;
  playableDays: PlayableDay[];
  roundRobinKind: 'single' | 'double';
  gamesPerDay: number;
}

/** `PATCH /games/:gameId/draft` - edit a draft Game's matchup and/or date. */
export interface EditDraftGameRequest {
  /** ISO date (YYYY-MM-DD). */
  date?: string;
  homeTeamId?: string;
  awayTeamId?: string;
}

/** `POST /games/:gameId/assign` - assign Venue + start time to a draft Game. */
export interface AssignVenueTimeRequest {
  venue: string;
  startTime: string;
  durationMinutes?: number;
}

// ---------------------------------------------------------------------------
// Statistics - Req 8
// ---------------------------------------------------------------------------

export type StatisticType =
  | 'Points'
  | 'Assists'
  | 'Rebounds'
  | 'Steals'
  | 'Blocks'
  | 'Three_Pointers_Made';

/** `POST /statistics` - record a Statistic value for a Player in a Game. */
export interface RecordStatisticRequest {
  playerId: string;
  gameId: string;
  type: StatisticType;
  /** 0-999 non-negative integer. */
  value: number;
}

/** The stored Statistic. */
export interface StatisticPayload {
  id: string;
  playerId: string;
  gameId: string;
  type: StatisticType;
  value: number;
}

/** One per-type total in a season stat line. */
export interface StatTotal {
  type: StatisticType;
  total: number;
}

/** Per-Player or per-Team season statistic totals (GET reads). */
export interface SeasonStatsPayload {
  seasonId: string;
  /** The player or team the totals belong to. */
  subjectId: string;
  totals: StatTotal[];
}

// ---------------------------------------------------------------------------
// Awards (management compute/publish + admin read) - Req 13
// ---------------------------------------------------------------------------

/** Result of computing Awards for a scope (unpublished until published). */
export interface ComputeAwardsResult {
  awards: Award[];
  /** False when no regular-season Statistics exist for the scope (Req 13.16). */
  regularSeasonAvailable: boolean;
  /** False when the scope has no completed Finals Games (Req 13.12). */
  finalsMvpAvailable: boolean;
}

/** Admin read of a scope's Awards (both published and unpublished). */
export interface ScopeAwardsPayload {
  scopeId: string;
  awards: Award[];
  message?: string;
}
