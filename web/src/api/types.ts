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
// Teams / Players (mutating management)
// ---------------------------------------------------------------------------

export interface Team {
  id: string;
  seasonId: string;
  name: string;
}

export interface Player {
  id: string;
  teamId: string;
  name: string;
  jerseyNumber: number;
}

export interface CreateTeamRequest {
  seasonId: string;
  name: string;
}

export interface UpdateTeamRequest {
  name: string;
}

export interface AddPlayerRequest {
  teamId: string;
  name: string;
  jerseyNumber: number;
}

export interface UpdatePlayerRequest {
  name?: string;
  jerseyNumber?: number;
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
