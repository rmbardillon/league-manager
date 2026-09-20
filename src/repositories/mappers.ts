/**
 * Row → domain mappers for the Repository Layer.
 *
 * Drizzle `$inferSelect` row types are close to the domain types but not
 * identical: a few columns are aggregated from adjacent tables (e.g. a User's
 * managed team ids and failed attempts) and a few enum-like columns are widened
 * to `string` by the driver. These pure functions perform the narrowing/shaping
 * so callers work with the domain vocabulary from `src/domain/types.ts`.
 *
 * No I/O, no business logic — mapping only.
 *
 * _Requirements: 3.7, 6.1, 11.3_
 */
import type {
  Award,
  BestOfN,
  Game,
  League,
  Player,
  PlayoffRound,
  Score,
  Season,
  Series,
  Session,
  Statistic,
  Team,
  Tournament,
  User,
} from '../domain/types.js';
import type {
  AwardRow,
  GameRow,
  LeagueRow,
  PlayerRow,
  PlayoffRoundRow,
  ScoreRow,
  SeasonRow,
  SeriesRow,
  SessionRow,
  StatisticRow,
  TeamRow,
  TournamentRow,
  UserRow,
} from '../db/schema.js';

export function toLeague(row: LeagueRow): League {
  return { id: row.id, name: row.name };
}

export function toSeason(row: SeasonRow): Season {
  const season: Season = {
    id: row.id,
    leagueId: row.leagueId,
    name: row.name,
    startDate: row.startDate,
    endDate: row.endDate,
    closed: row.closed,
  };
  if (row.finalStandingsSnapshot != null) {
    season.finalStandingsSnapshot = row.finalStandingsSnapshot;
  }
  return season;
}

export function toTournament(row: TournamentRow): Tournament {
  const tournament: Tournament = {
    id: row.id,
    seasonId: row.seasonId,
    format: row.format,
  };
  if (row.roundRobinKind != null) {
    tournament.roundRobinKind = row.roundRobinKind;
  }
  return tournament;
}

export function toTeam(row: TeamRow): Team {
  return { id: row.id, seasonId: row.seasonId, name: row.name };
}

export function toPlayer(row: PlayerRow): Player {
  return {
    id: row.id,
    teamId: row.teamId,
    name: row.name,
    jerseyNumber: row.jerseyNumber,
  };
}

export function toPlayoffRound(row: PlayoffRoundRow): PlayoffRound {
  return { id: row.id, seasonId: row.seasonId, type: row.type };
}

export function toSeries(row: SeriesRow): Series {
  return {
    id: row.id,
    playoffRoundId: row.playoffRoundId,
    teamAId: row.teamAId,
    teamBId: row.teamBId,
    bestOf: row.bestOf as BestOfN,
  };
}

export function toGame(row: GameRow): Game {
  return {
    id: row.id,
    seasonId: row.seasonId,
    homeTeamId: row.homeTeamId,
    awayTeamId: row.awayTeamId,
    date: row.date,
    startTime: row.startTime,
    durationMinutes: row.durationMinutes,
    venue: row.venue,
    status: row.status,
    scheduleState: row.scheduleState,
    playoffRoundId: row.playoffRoundId,
    seriesId: row.seriesId,
  };
}

export function toScore(row: ScoreRow): Score {
  return {
    gameId: row.gameId,
    homeScore: row.homeScore,
    awayScore: row.awayScore,
    completedAt: row.completedAt,
  };
}

export function toStatistic(row: StatisticRow): Statistic {
  return {
    id: row.id,
    playerId: row.playerId,
    gameId: row.gameId,
    type: row.type,
    value: row.value,
  };
}

/**
 * Compose a {@link User} from its base row plus the aggregated managed-team
 * ids and failed-attempt timestamps loaded from the adjacent tables.
 */
export function toUser(
  row: UserRow,
  managedTeamIds: string[],
  failedAttempts: { at: Date }[],
): User {
  return {
    id: row.id,
    username: row.username,
    passwordHash: row.passwordHash,
    role: row.role,
    managedTeamIds,
    failedAttempts,
    lockedUntil: row.lockedUntil,
  };
}

export function toSession(row: SessionRow): Session {
  return {
    id: row.id,
    userId: row.userId,
    role: row.role,
    createdAt: row.createdAt,
    lastActivityAt: row.lastActivityAt,
  };
}

/**
 * Compose an {@link Award} from its base row plus the ordered player ids
 * loaded from the `award_players` join table.
 */
export function toAward(row: AwardRow, playerIds: string[]): Award {
  return {
    id: row.id,
    scopeId: row.scopeId,
    category: row.category,
    playerIds,
    published: row.published,
  };
}
