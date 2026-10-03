/**
 * Shared domain types and enums for the Basketball League Management System.
 *
 * These definitions mirror the "Data Models" section of the design document.
 * They form the pure, I/O-free vocabulary used across the domain, service,
 * repository, and API layers.
 *
 * _Requirements: 8.1, 9.5, 9.9_
 */

// ---------------------------------------------------------------------------
// Enums / string-literal unions
// ---------------------------------------------------------------------------

/**
 * The six supported statistic types (Req 8.1). Exactly six values — no more,
 * no less. `StatisticTypes` provides a runtime-iterable list for validation.
 */
export type StatisticType =
  | 'Points'
  | 'Assists'
  | 'Rebounds'
  | 'Steals'
  | 'Blocks'
  | 'Three_Pointers_Made';

/** Runtime tuple of all six {@link StatisticType} values (Req 8.1). */
export const StatisticTypes = [
  'Points',
  'Assists',
  'Rebounds',
  'Steals',
  'Blocks',
  'Three_Pointers_Made',
] as const satisfies readonly StatisticType[];

/** Supported tournament formats (Req 9.5). */
export type TournamentFormat =
  | 'single-elimination'
  | 'double-elimination'
  | 'round-robin';

/** Runtime tuple of all {@link TournamentFormat} values (Req 9.5). */
export const TournamentFormats = [
  'single-elimination',
  'double-elimination',
  'round-robin',
] as const satisfies readonly TournamentFormat[];

/** Playoff round classifications (Req 9.9). */
export type PlayoffRoundType = 'Quarterfinals' | 'Semifinals' | 'Finals';

/** Runtime tuple of all {@link PlayoffRoundType} values (Req 9.9). */
export const PlayoffRoundTypes = [
  'Quarterfinals',
  'Semifinals',
  'Finals',
] as const satisfies readonly PlayoffRoundType[];

/** Valid best-of-N series lengths. */
export type BestOfN = 1 | 3 | 5 | 7;

/** Runtime tuple of all valid {@link BestOfN} values. */
export const BestOfNValues = [1, 3, 5, 7] as const satisfies readonly BestOfN[];

/** Lifecycle status of a Game. */
export type GameStatus = 'scheduled' | 'completed' | 'cancelled';

/** Runtime tuple of all {@link GameStatus} values. */
export const GameStatuses = [
  'scheduled',
  'completed',
  'cancelled',
] as const satisfies readonly GameStatus[];

/** Visibility state of a Game's schedule (draft-then-submit workflow). */
export type ScheduleState = 'draft' | 'official';

/** Runtime tuple of all {@link ScheduleState} values. */
export const ScheduleStates = [
  'draft',
  'official',
] as const satisfies readonly ScheduleState[];

/** User roles for role-based access control. */
export type Role = 'Administrator' | 'Team_Manager' | 'Viewer';

/** Runtime tuple of all {@link Role} values. */
export const Roles = [
  'Administrator',
  'Team_Manager',
  'Viewer',
] as const satisfies readonly Role[];

/** Award categories granted per Season/Tournament. */
export type AwardCategory =
  | 'MVP'
  | 'Mythical_5'
  | 'Best_in_3_Pointers'
  | 'DPOY'
  | 'Assists_Leader'
  | 'Finals_MVP';

/** Runtime tuple of all {@link AwardCategory} values. */
export const AwardCategories = [
  'MVP',
  'Mythical_5',
  'Best_in_3_Pointers',
  'DPOY',
  'Assists_Leader',
  'Finals_MVP',
] as const satisfies readonly AwardCategory[];

// ---------------------------------------------------------------------------
// Entities
// ---------------------------------------------------------------------------

export interface User {
  id: string;
  username: string;
  passwordHash: string;
  /** null → deny all actions (Req 2.5). */
  role: Role | null;
  /** Teams managed by a Team_Manager. */
  managedTeamIds: string[];
  /** Timestamped failed sign-in attempts for the rolling-window lockout. */
  failedAttempts: { at: Date }[];
  lockedUntil: Date | null;
}

export interface Session {
  id: string;
  userId: string;
  role: Role;
  createdAt: Date;
  /** Sliding 30-minute inactivity expiry (Req 1.2). */
  lastActivityAt: Date;
}

export interface League {
  id: string;
  name: string;
}

export interface Season {
  id: string;
  leagueId: string;
  /** 1–100 chars, unique within the League. */
  name: string;
  startDate: Date;
  /** Must be strictly after startDate. */
  endDate: Date;
  closed: boolean;
  /** Recorded when the Season is closed (Req 10.5). */
  finalStandingsSnapshot?: StandingRow[];
}

export interface Tournament {
  id: string;
  seasonId: string;
  format: TournamentFormat;
  /** Present when the format is round-robin. */
  roundRobinKind?: 'single' | 'double';
}

export interface Team {
  id: string;
  seasonId: string;
  /** 1–100 chars, unique (case-insensitive) within the Season. */
  name: string;
}

/** A master Player (a person). */
export interface Player {
  id: string;
  /** 1–100 chars. Not unique. */
  name: string;
}

/** Links one master Player to one Team (and thus one Season) with a jersey. */
export interface RosterAssignment {
  id: string;
  playerId: string;
  teamId: string;
  /** 0–99, unique within the Team roster. */
  jerseyNumber: number;
}

/** A roster entry as read for a Team (Player identity + jersey). */
export interface RosterEntry {
  playerId: string;
  name: string;
  jerseyNumber: number;
}

/** A player-history entry (which Team/Season and jersey). */
export interface PlayerHistoryEntry {
  assignmentId: string;
  teamId: string;
  seasonId: string;
  jerseyNumber: number;
}

export interface Game {
  id: string;
  seasonId: string;
  homeTeamId: string;
  /** Must differ from homeTeamId. */
  awayTeamId: string;
  date: Date;
  /** null for generated draft Games (Req 12.10). */
  startTime: string | null;
  /** 1–480 minutes. */
  durationMinutes: number | null;
  /** null for generated draft Games. */
  venue: string | null;
  status: GameStatus;
  scheduleState: ScheduleState;
  /** null → regular season Game (Req 9.8). */
  playoffRoundId: string | null;
  seriesId: string | null;
}

export interface Score {
  gameId: string;
  /** 0–999 integer. */
  homeScore: number;
  /** 0–999 integer. */
  awayScore: number;
  completedAt: Date;
}

export interface Statistic {
  id: string;
  playerId: string;
  gameId: string;
  type: StatisticType;
  /** 0–999 non-negative integer. */
  value: number;
}

export interface PlayoffRound {
  id: string;
  seasonId: string;
  type: PlayoffRoundType;
}

export interface Series {
  id: string;
  playoffRoundId: string;
  teamAId: string;
  teamBId: string;
  /** 1, 3, 5, or 7. */
  bestOf: BestOfN;
}

export interface StandingRow {
  teamId: string;
  wins: number;
  losses: number;
  /** Equal rank when teams are fully tied (Req 7.7). */
  rank: number;
}

export interface Award {
  id: string;
  /** Season or Tournament id. */
  scopeId: string;
  category: AwardCategory;
  /** One player for most awards; five for Mythical 5. */
  playerIds: string[];
  /** Hidden until published (Req 13.13–13.15). */
  published: boolean;
}
