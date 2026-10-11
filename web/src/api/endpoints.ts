/**
 * Typed endpoint functions for the Basketball League Management REST API.
 *
 * Each function names a single backend route, its inputs, and its response
 * type, delegating transport to {@link request}. Grouped by concern:
 *
 *   - `authApi`        — sign-in/out and current-principal (Req 1.1).
 *   - `publicApi`      — unauthenticated schedule/results/standings/awards/seasons
 *                        reads (Req 7.4, 10.1, 10.6, 13.15).
 *   - `leaguesApi`     — authenticated League/Season list reads (Req 2.1, 2.2).
 *   - `seasonsApi`     — Season management + list reads (Req 4.2, 2.3, 8.2, 9.2, 9.6).
 *   - `playoffApi`     — playoff series list/create (Req 9.4).
 *   - `teamsApi`       — Team management (Req 3.1).
 *   - `playersApi`     — master-Player registry reads/writes (Req 6.4).
 *   - `assignmentsApi` — Team roster + assignment management (Req 6.5, 6.8, 6.9).
 *
 * Note on auth and public-awards paths: the backend does not yet expose a
 * sign-in controller or a public published-Awards read (see the routes' own
 * comments). This client targets the documented paths — `POST /auth/signin`,
 * `POST /auth/signout`, `GET /auth/me`, and `GET /public/scopes/:scopeId/awards`
 * — so the SPA works unchanged once those endpoints are wired.
 */
import { request } from './client.js';
import type {
  AssignPlayerRequest,
  BatchUploadRequest,
  BatchUploadResult,
  AuthUser,
  CreatePlayerRequest,
  UpdatePlayerRequest,
  CreatePlayoffGameRequest,
  CreatePlayoffRoundRequest,
  CreateSeasonRequest,
  CreateSeriesRequest,
  CreateTeamRequest,
  CreateTournamentRequest,
  LeagueSummary,
  Player,
  PlayoffRoundSummary,
  PublicSeasonsPayload,
  PublishedAwardsPayload,
  ResultsPayload,
  RosterAssignment,
  RosterEntry,
  SchedulePayload,
  SeasonSummary,
  SeriesSummary,
  SignInRequest,
  StandingsPayload,
  Team,
  TeamSummary,
  TournamentSummary,
  UpdateJerseyRequest,
  UpdateTeamRequest,
} from './types.js';

/** Authentication flows (Req 1.1). */
export const authApi = {
  /**
   * Sign in with credentials. On success the backend sets an HTTP-only session
   * cookie and returns the authenticated principal scoped to the User's role
   * (Req 1.1). A 401 rejects with an {@link ApiError} whose message is generic
   * (Req 1.3); a 423 signals a locked account (Req 1.6).
   */
  signIn(credentials: SignInRequest): Promise<AuthUser> {
    return request<AuthUser>('/auth/signin', { method: 'POST', body: credentials });
  },

  /** Terminate the current session (Req 1.5). */
  signOut(): Promise<void> {
    return request<void>('/auth/signout', { method: 'POST' });
  },

  /**
   * Resolve the currently authenticated principal from the session cookie, used
   * to restore auth state on page load. Rejects with a 401 when no valid
   * session exists.
   */
  me(signal?: AbortSignal): Promise<AuthUser> {
    return request<AuthUser>('/auth/me', { signal });
  },
};

/** Unauthenticated public browsing reads (Req 10.6). */
export const publicApi = {
  /** Seasons available for public browsing; empty → `{ seasons: [], message }` (Req 7.4). */
  seasons(signal?: AbortSignal): Promise<PublicSeasonsPayload> {
    return request<PublicSeasonsPayload>('/public/seasons', { signal });
  },

  /** Season schedule ordered by date then start time (Req 10.1). */
  schedule(seasonId: string, signal?: AbortSignal): Promise<SchedulePayload> {
    return request<SchedulePayload>(
      `/public/seasons/${encodeURIComponent(seasonId)}/schedule`,
      { signal },
    );
  },

  /** Completed-Game results with scores and completion date (Req 10.3). */
  results(seasonId: string, signal?: AbortSignal): Promise<ResultsPayload> {
    return request<ResultsPayload>(
      `/public/seasons/${encodeURIComponent(seasonId)}/results`,
      { signal },
    );
  },

  /** Standings — live for open Seasons, snapshot for closed (Req 10.4, 10.5). */
  standings(seasonId: string, signal?: AbortSignal): Promise<StandingsPayload> {
    return request<StandingsPayload>(
      `/public/seasons/${encodeURIComponent(seasonId)}/standings`,
      { signal },
    );
  },

  /** Published Awards for a scope; Viewers see exactly the published set (Req 13.15). */
  publishedAwards(scopeId: string, signal?: AbortSignal): Promise<PublishedAwardsPayload> {
    return request<PublishedAwardsPayload>(
      `/public/scopes/${encodeURIComponent(scopeId)}/awards`,
      { signal },
    );
  },
};

/** Authenticated League/Season list reads (Req 2.1, 2.2). */
export const leaguesApi = {
  /** All Leagues the Administrator may manage (Req 2.1). */
  list(signal?: AbortSignal): Promise<LeagueSummary[]> {
    return request<LeagueSummary[]>('/leagues', { signal });
  },

  /** Seasons belonging to a League (Req 2.2). */
  seasons(leagueId: string, signal?: AbortSignal): Promise<SeasonSummary[]> {
    return request<SeasonSummary[]>(
      `/leagues/${encodeURIComponent(leagueId)}/seasons`,
      { signal },
    );
  },
};

/** Season management and Season-scoped list reads (Req 4.2, 2.3, 8.2, 9.2, 9.6). */
export const seasonsApi = {
  /** Create a Season in a League (Req 4.2). */
  create(input: CreateSeasonRequest): Promise<SeasonSummary> {
    return request<SeasonSummary>('/seasons', { method: 'POST', body: input });
  },

  /** Close a Season, snapshotting its final Standings (Req 4.5). */
  close(seasonId: string): Promise<SeasonSummary> {
    return request<SeasonSummary>(
      `/seasons/${encodeURIComponent(seasonId)}/close`,
      { method: 'POST' },
    );
  },

  /** Teams registered in a Season (Req 2.3). */
  teams(seasonId: string, signal?: AbortSignal): Promise<TeamSummary[]> {
    return request<TeamSummary[]>(
      `/seasons/${encodeURIComponent(seasonId)}/teams`,
      { signal },
    );
  },

  /** Tournaments defined for a Season (Req 8.2). */
  tournaments(seasonId: string, signal?: AbortSignal): Promise<TournamentSummary[]> {
    return request<TournamentSummary[]>(
      `/seasons/${encodeURIComponent(seasonId)}/tournaments`,
      { signal },
    );
  },

  /** Create a Tournament in a Season (Req 8.2). */
  createTournament(
    seasonId: string,
    input: CreateTournamentRequest,
  ): Promise<TournamentSummary> {
    return request<TournamentSummary>(
      `/seasons/${encodeURIComponent(seasonId)}/tournaments`,
      { method: 'POST', body: input },
    );
  },

  /** Playoff rounds defined for a Season (Req 9.2). */
  playoffRounds(seasonId: string, signal?: AbortSignal): Promise<PlayoffRoundSummary[]> {
    return request<PlayoffRoundSummary[]>(
      `/seasons/${encodeURIComponent(seasonId)}/playoff-rounds`,
      { signal },
    );
  },

  /** Create a playoff round in a Season (Req 9.2). */
  createPlayoffRound(
    seasonId: string,
    input: CreatePlayoffRoundRequest,
  ): Promise<PlayoffRoundSummary> {
    return request<PlayoffRoundSummary>(
      `/seasons/${encodeURIComponent(seasonId)}/playoff-rounds`,
      { method: 'POST', body: input },
    );
  },

  /** Create a playoff Game in a Season (Req 9.6). */
  createPlayoffGame(seasonId: string, input: CreatePlayoffGameRequest): Promise<void> {
    return request<void>(
      `/seasons/${encodeURIComponent(seasonId)}/playoff-games`,
      { method: 'POST', body: input },
    );
  },
};

/** Playoff series list/create under a round (Req 9.4). */
export const playoffApi = {
  /** Series defined under a playoff round (Req 9.4). */
  series(roundId: string, signal?: AbortSignal): Promise<SeriesSummary[]> {
    return request<SeriesSummary[]>(
      `/playoff-rounds/${encodeURIComponent(roundId)}/series`,
      { signal },
    );
  },

  /** Create a series under a playoff round (Req 9.4). */
  createSeries(roundId: string, input: CreateSeriesRequest): Promise<SeriesSummary> {
    return request<SeriesSummary>(
      `/playoff-rounds/${encodeURIComponent(roundId)}/series`,
      { method: 'POST', body: input },
    );
  },
};

/** Team management (Req 3.1). */
export const teamsApi = {
  /** Create a Team in a Season (Req 3.1). */
  create(input: CreateTeamRequest): Promise<Team> {
    return request<Team>('/teams', { method: 'POST', body: input });
  },

  /** Rename a Team (Req 3.5). */
  update(teamId: string, input: UpdateTeamRequest): Promise<Team> {
    return request<Team>(`/teams/${encodeURIComponent(teamId)}`, {
      method: 'PATCH',
      body: input,
    });
  },

  /** Delete a Team with no completed Games (Req 3.7). */
  remove(teamId: string): Promise<void> {
    return request<void>(`/teams/${encodeURIComponent(teamId)}`, { method: 'DELETE' });
  },
};

/** Master-Player registry reads/writes (Req 6.4). */
export const playersApi = {
  /** All master Players, listed by name (Req 6.4). */
  listMasters(signal?: AbortSignal): Promise<Player[]> {
    return request<Player[]>('/players', { signal });
  },

  /** Register a new master Player (Req 6.4). */
  createMaster(input: CreatePlayerRequest): Promise<Player> {
    return request<Player>('/players', { method: 'POST', body: input });
  },

  /** Rename a master Player (Req 6.4). */
  rename(playerId: string, input: UpdatePlayerRequest): Promise<Player> {
    return request<Player>(`/players/${encodeURIComponent(playerId)}`, {
      method: 'PATCH',
      body: input,
    });
  },

  /** Remove a master Player; rejected (409) when still assigned to a Team. */
  remove(playerId: string): Promise<void> {
    return request<void>(`/players/${encodeURIComponent(playerId)}`, { method: 'DELETE' });
  },
};

/** Team roster and assignment management (Req 6.5, 6.8, 6.9). */
export const assignmentsApi = {
  /** A Team's current roster (Req 6.5). */
  roster(teamId: string, signal?: AbortSignal): Promise<RosterEntry[]> {
    return request<RosterEntry[]>(
      `/teams/${encodeURIComponent(teamId)}/roster`,
      { signal },
    );
  },

  /** Assign a master Player to a Team with a jersey number (Req 6.5). */
  assign(teamId: string, input: AssignPlayerRequest): Promise<RosterAssignment> {
    return request<RosterAssignment>(
      `/teams/${encodeURIComponent(teamId)}/assignments`,
      { method: 'POST', body: input },
    );
  },

  /** Change a roster assignment's jersey number (Req 6.8). */
  updateJersey(
    teamId: string,
    playerId: string,
    input: UpdateJerseyRequest,
  ): Promise<RosterAssignment> {
    return request<RosterAssignment>(
      `/teams/${encodeURIComponent(teamId)}/assignments/${encodeURIComponent(playerId)}`,
      { method: 'PATCH', body: input },
    );
  },

  /** Unassign a Player from a Team; the master Player is retained (Req 6.9). */
  unassign(teamId: string, playerId: string): Promise<void> {
    return request<void>(
      `/teams/${encodeURIComponent(teamId)}/assignments/${encodeURIComponent(playerId)}`,
      { method: 'DELETE' },
    );
  },
};

/** Season-scoped Batch_Upload of Teams + Players from a CSV/.xlsx file (Req 11). */
export const batchApi = {
  /** Import Teams and Players into a Season from an uploaded file (Admin-only). */
  upload(seasonId: string, input: BatchUploadRequest): Promise<BatchUploadResult> {
    return request<BatchUploadResult>(
      `/seasons/${encodeURIComponent(seasonId)}/batch-upload`,
      { method: 'POST', body: input },
    );
  },
};
