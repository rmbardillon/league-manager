/**
 * Drizzle schema for the Basketball League Management System.
 *
 * This is the full relational model (Task 13.1) matching the "Data Models"
 * section of the design document and the domain types in src/domain/types.ts.
 *
 * Relationship spine (foreign keys):
 *   League → Season → Team → Player
 *   Season → Game → Statistic  (Player → Statistic as well)
 *   Game → Score (one-to-one)
 *   Season → Tournament
 *   Season → PlayoffRound → Series → Game
 *   User ↔ Team (managed teams, many-to-many)
 *   Season → Award → Player (many-to-many via award_players)
 *
 * Enums mirror the string-literal unions in the domain layer:
 *   StatisticType, TournamentFormat, PlayoffRoundType, GameStatus,
 *   ScheduleState, Role, AwardCategory.
 *
 * _Requirements: 3.1, 4.1, 5.1, 8.2, 9.1_
 */
import {
  pgTable,
  pgEnum,
  uuid,
  text,
  integer,
  smallint,
  boolean,
  timestamp,
  jsonb,
  unique,
  uniqueIndex,
  check,
  primaryKey,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import type {
  Role as DomainRole,
  StatisticType as DomainStatisticType,
  TournamentFormat as DomainTournamentFormat,
  PlayoffRoundType as DomainPlayoffRoundType,
  GameStatus as DomainGameStatus,
  ScheduleState as DomainScheduleState,
  AwardCategory as DomainAwardCategory,
  StandingRow,
} from '../domain/types.js';

// ---------------------------------------------------------------------------
// Enums (PostgreSQL enum types) — kept in lock-step with src/domain/types.ts
// ---------------------------------------------------------------------------

export const roleEnum = pgEnum('role', [
  'Administrator',
  'Team_Manager',
  'Viewer',
] as const satisfies readonly DomainRole[]);

export const statisticTypeEnum = pgEnum('statistic_type', [
  'Points',
  'Assists',
  'Rebounds',
  'Steals',
  'Blocks',
  'Three_Pointers_Made',
] as const satisfies readonly DomainStatisticType[]);

export const tournamentFormatEnum = pgEnum('tournament_format', [
  'single-elimination',
  'double-elimination',
  'round-robin',
] as const satisfies readonly DomainTournamentFormat[]);

export const roundRobinKindEnum = pgEnum('round_robin_kind', ['single', 'double'] as const);

export const playoffRoundTypeEnum = pgEnum('playoff_round_type', [
  'Quarterfinals',
  'Semifinals',
  'Finals',
] as const satisfies readonly DomainPlayoffRoundType[]);

export const gameStatusEnum = pgEnum('game_status', [
  'scheduled',
  'completed',
  'cancelled',
] as const satisfies readonly DomainGameStatus[]);

export const scheduleStateEnum = pgEnum('schedule_state', [
  'draft',
  'official',
] as const satisfies readonly DomainScheduleState[]);

export const awardCategoryEnum = pgEnum('award_category', [
  'MVP',
  'Mythical_5',
  'Best_in_3_Pointers',
  'DPOY',
  'Assists_Leader',
  'Finals_MVP',
] as const satisfies readonly DomainAwardCategory[]);

// ---------------------------------------------------------------------------
// League → Season → Team → Player
// ---------------------------------------------------------------------------

export const leagues = pgTable(
  'leagues',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    // 1–100 chars.
    name: text('name').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [check('leagues_name_len_chk', sql`char_length(${t.name}) between 1 and 100`)],
);

export const seasons = pgTable(
  'seasons',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    leagueId: uuid('league_id')
      .notNull()
      .references(() => leagues.id, { onDelete: 'cascade' }),
    // 1–100 chars, unique within the League.
    name: text('name').notNull(),
    startDate: timestamp('start_date', { withTimezone: true }).notNull(),
    // Must be strictly after startDate.
    endDate: timestamp('end_date', { withTimezone: true }).notNull(),
    closed: boolean('closed').notNull().default(false),
    // Recorded snapshot when the Season is closed (Req 10.5). Array of StandingRow.
    finalStandingsSnapshot: jsonb('final_standings_snapshot').$type<StandingRow[]>(),
  },
  (t) => [
    unique('seasons_league_name_uq').on(t.leagueId, t.name),
    check('seasons_name_len_chk', sql`char_length(${t.name}) between 1 and 100`),
    check('seasons_date_order_chk', sql`${t.endDate} > ${t.startDate}`),
  ],
);

export const tournaments = pgTable('tournaments', {
  id: uuid('id').primaryKey().defaultRandom(),
  seasonId: uuid('season_id')
    .notNull()
    .references(() => seasons.id, { onDelete: 'cascade' }),
  format: tournamentFormatEnum('format').notNull(),
  // Present when the format is round-robin.
  roundRobinKind: roundRobinKindEnum('round_robin_kind'),
});

export const teams = pgTable(
  'teams',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    seasonId: uuid('season_id')
      .notNull()
      .references(() => seasons.id, { onDelete: 'cascade' }),
    // 1–100 chars, unique (case-insensitive) within the Season.
    name: text('name').notNull(),
  },
  (t) => [
    // Case-insensitive uniqueness within a Season.
    uniqueIndex('teams_season_name_ci_uq').on(t.seasonId, sql`lower(${t.name})`),
    check('teams_name_len_chk', sql`char_length(${t.name}) between 1 and 100`),
  ],
);

export const players = pgTable(
  'players',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    teamId: uuid('team_id')
      .notNull()
      .references(() => teams.id, { onDelete: 'cascade' }),
    // 1–100 chars.
    name: text('name').notNull(),
    // 0–99, unique within the Team roster.
    jerseyNumber: smallint('jersey_number').notNull(),
  },
  (t) => [
    unique('players_team_jersey_uq').on(t.teamId, t.jerseyNumber),
    check('players_name_len_chk', sql`char_length(${t.name}) between 1 and 100`),
    check('players_jersey_range_chk', sql`${t.jerseyNumber} between 0 and 99`),
  ],
);

// ---------------------------------------------------------------------------
// Playoff structure: PlayoffRound → Series → Game
// ---------------------------------------------------------------------------

export const playoffRounds = pgTable('playoff_rounds', {
  id: uuid('id').primaryKey().defaultRandom(),
  seasonId: uuid('season_id')
    .notNull()
    .references(() => seasons.id, { onDelete: 'cascade' }),
  type: playoffRoundTypeEnum('type').notNull(),
});

export const series = pgTable(
  'series',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    playoffRoundId: uuid('playoff_round_id')
      .notNull()
      .references(() => playoffRounds.id, { onDelete: 'cascade' }),
    teamAId: uuid('team_a_id')
      .notNull()
      .references(() => teams.id, { onDelete: 'restrict' }),
    teamBId: uuid('team_b_id')
      .notNull()
      .references(() => teams.id, { onDelete: 'restrict' }),
    // 1, 3, 5, or 7.
    bestOf: smallint('best_of').notNull(),
  },
  (t) => [
    check('series_best_of_chk', sql`${t.bestOf} in (1, 3, 5, 7)`),
    check('series_distinct_teams_chk', sql`${t.teamAId} <> ${t.teamBId}`),
  ],
);

// ---------------------------------------------------------------------------
// Games (Season → Game; Team home/away; optional PlayoffRound/Series)
// ---------------------------------------------------------------------------

export const games = pgTable(
  'games',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    seasonId: uuid('season_id')
      .notNull()
      .references(() => seasons.id, { onDelete: 'cascade' }),
    homeTeamId: uuid('home_team_id')
      .notNull()
      .references(() => teams.id, { onDelete: 'restrict' }),
    // Must differ from homeTeamId.
    awayTeamId: uuid('away_team_id')
      .notNull()
      .references(() => teams.id, { onDelete: 'restrict' }),
    date: timestamp('date', { withTimezone: true }).notNull(),
    // null for generated draft Games (Req 12.10). Stored as 'HH:MM'.
    startTime: text('start_time'),
    // 1–480 minutes; null for generated draft Games.
    durationMinutes: integer('duration_minutes'),
    // null for generated draft Games.
    venue: text('venue'),
    status: gameStatusEnum('status').notNull().default('scheduled'),
    scheduleState: scheduleStateEnum('schedule_state').notNull().default('official'),
    // null → regular season Game (Req 9.8).
    playoffRoundId: uuid('playoff_round_id').references(() => playoffRounds.id, {
      onDelete: 'set null',
    }),
    seriesId: uuid('series_id').references(() => series.id, { onDelete: 'set null' }),
  },
  (t) => [
    check('games_distinct_teams_chk', sql`${t.homeTeamId} <> ${t.awayTeamId}`),
    check(
      'games_duration_range_chk',
      sql`${t.durationMinutes} is null or ${t.durationMinutes} between 1 and 480`,
    ),
  ],
);

// ---------------------------------------------------------------------------
// Score (one-to-one with Game; PK = gameId)
// ---------------------------------------------------------------------------

export const scores = pgTable(
  'scores',
  {
    gameId: uuid('game_id')
      .primaryKey()
      .references(() => games.id, { onDelete: 'cascade' }),
    // 0–999 integer.
    homeScore: integer('home_score').notNull(),
    // 0–999 integer.
    awayScore: integer('away_score').notNull(),
    completedAt: timestamp('completed_at', { withTimezone: true }).notNull(),
  },
  (t) => [
    check('scores_home_range_chk', sql`${t.homeScore} between 0 and 999`),
    check('scores_away_range_chk', sql`${t.awayScore} between 0 and 999`),
  ],
);

// ---------------------------------------------------------------------------
// Statistic (Player → Statistic, Game → Statistic)
// ---------------------------------------------------------------------------

export const statistics = pgTable(
  'statistics',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    playerId: uuid('player_id')
      .notNull()
      .references(() => players.id, { onDelete: 'cascade' }),
    gameId: uuid('game_id')
      .notNull()
      .references(() => games.id, { onDelete: 'cascade' }),
    type: statisticTypeEnum('type').notNull(),
    // 0–999 non-negative integer.
    value: integer('value').notNull(),
  },
  (t) => [
    // One row per (player, game, statistic type).
    unique('statistics_player_game_type_uq').on(t.playerId, t.gameId, t.type),
    check('statistics_value_range_chk', sql`${t.value} between 0 and 999`),
  ],
);

// ---------------------------------------------------------------------------
// Users and the User ↔ Team management relationship
// ---------------------------------------------------------------------------

export const users = pgTable(
  'users',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    username: text('username').notNull().unique(),
    passwordHash: text('password_hash').notNull(),
    // null → deny all actions (Req 2.5).
    role: roleEnum('role'),
    lockedUntil: timestamp('locked_until', { withTimezone: true }),
  },
);

/** Many-to-many: a Team_Manager manages one or more Teams (User.managedTeamIds). */
export const userManagedTeams = pgTable(
  'user_managed_teams',
  {
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    teamId: uuid('team_id')
      .notNull()
      .references(() => teams.id, { onDelete: 'cascade' }),
  },
  (t) => [primaryKey({ columns: [t.userId, t.teamId] })],
);

/** Timestamped failed sign-in attempts backing the rolling-window lockout. */
export const userFailedAttempts = pgTable('user_failed_attempts', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  attemptedAt: timestamp('attempted_at', { withTimezone: true }).notNull().defaultNow(),
});

// ---------------------------------------------------------------------------
// Sessions
// ---------------------------------------------------------------------------

export const sessions = pgTable('sessions', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  role: roleEnum('role').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  // Sliding 30-minute inactivity expiry (Req 1.2).
  lastActivityAt: timestamp('last_activity_at', { withTimezone: true }).notNull().defaultNow(),
});

// ---------------------------------------------------------------------------
// Awards (Season → Award → Player)
// ---------------------------------------------------------------------------

export const awards = pgTable('awards', {
  id: uuid('id').primaryKey().defaultRandom(),
  // Season or Tournament id (scope).
  scopeId: uuid('scope_id').notNull(),
  category: awardCategoryEnum('category').notNull(),
  // Hidden until published (Req 13.13–13.15).
  published: boolean('published').notNull().default(false),
});

/** One player for most awards; five for Mythical 5 (Award.playerIds). */
export const awardPlayers = pgTable(
  'award_players',
  {
    awardId: uuid('award_id')
      .notNull()
      .references(() => awards.id, { onDelete: 'cascade' }),
    playerId: uuid('player_id')
      .notNull()
      .references(() => players.id, { onDelete: 'cascade' }),
  },
  (t) => [primaryKey({ columns: [t.awardId, t.playerId] })],
);

// ---------------------------------------------------------------------------
// Inferred row types
// ---------------------------------------------------------------------------

export type LeagueRow = typeof leagues.$inferSelect;
export type NewLeagueRow = typeof leagues.$inferInsert;
export type SeasonRow = typeof seasons.$inferSelect;
export type NewSeasonRow = typeof seasons.$inferInsert;
export type TournamentRow = typeof tournaments.$inferSelect;
export type NewTournamentRow = typeof tournaments.$inferInsert;
export type TeamRow = typeof teams.$inferSelect;
export type NewTeamRow = typeof teams.$inferInsert;
export type PlayerRow = typeof players.$inferSelect;
export type NewPlayerRow = typeof players.$inferInsert;
export type PlayoffRoundRow = typeof playoffRounds.$inferSelect;
export type NewPlayoffRoundRow = typeof playoffRounds.$inferInsert;
export type SeriesRow = typeof series.$inferSelect;
export type NewSeriesRow = typeof series.$inferInsert;
export type GameRow = typeof games.$inferSelect;
export type NewGameRow = typeof games.$inferInsert;
export type ScoreRow = typeof scores.$inferSelect;
export type NewScoreRow = typeof scores.$inferInsert;
export type StatisticRow = typeof statistics.$inferSelect;
export type NewStatisticRow = typeof statistics.$inferInsert;
export type UserRow = typeof users.$inferSelect;
export type NewUserRow = typeof users.$inferInsert;
export type UserManagedTeamRow = typeof userManagedTeams.$inferSelect;
export type NewUserManagedTeamRow = typeof userManagedTeams.$inferInsert;
export type UserFailedAttemptRow = typeof userFailedAttempts.$inferSelect;
export type NewUserFailedAttemptRow = typeof userFailedAttempts.$inferInsert;
export type SessionRow = typeof sessions.$inferSelect;
export type NewSessionRow = typeof sessions.$inferInsert;
export type AwardRow = typeof awards.$inferSelect;
export type NewAwardRow = typeof awards.$inferInsert;
export type AwardPlayerRow = typeof awardPlayers.$inferSelect;
export type NewAwardPlayerRow = typeof awardPlayers.$inferInsert;
