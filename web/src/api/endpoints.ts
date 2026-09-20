/**
 * Typed endpoint functions for the Basketball League Management REST API.
 *
 * Each function names a single backend route, its inputs, and its response
 * type, delegating transport to {@link request}. Grouped by concern:
 *
 *   - `authApi`   — sign-in/out and current-principal (Req 1.1).
 *   - `publicApi` — unauthenticated schedule/results/standings/awards reads
 *                   (Req 10.1, 10.6, 13.15).
 *   - `teamsApi`  — Team management (Req 3.1).
 *   - `playersApi`— roster management (Req 4.1).
 *
 * Note on auth and public-awards paths: the backend does not yet expose a
 * sign-in controller or a public published-Awards read (see the routes' own
 * comments). This client targets the documented paths — `POST /auth/signin`,
 * `POST /auth/signout`, `GET /auth/me`, and `GET /public/scopes/:scopeId/awards`
 * — so the SPA works unchanged once those endpoints are wired.
 */
import { request } from './client.js';
import type {
  AddPlayerRequest,
  AuthUser,
  CreateTeamRequest,
  Player,
  PublishedAwardsPayload,
  ResultsPayload,
  SchedulePayload,
  SignInRequest,
  StandingsPayload,
  Team,
  UpdatePlayerRequest,
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

/** Roster (Player) management (Req 4.1). */
export const playersApi = {
  /** Add a Player to a Team roster (Req 4.1). */
  add(input: AddPlayerRequest): Promise<Player> {
    return request<Player>('/players', { method: 'POST', body: input });
  },

  /** Update a Player's name and/or jersey number (Req 4.7). */
  update(playerId: string, input: UpdatePlayerRequest): Promise<Player> {
    return request<Player>(`/players/${encodeURIComponent(playerId)}`, {
      method: 'PATCH',
      body: input,
    });
  },

  /** Remove a Player from a roster (Req 4.5). */
  remove(playerId: string): Promise<void> {
    return request<void>(`/players/${encodeURIComponent(playerId)}`, { method: 'DELETE' });
  },
};
