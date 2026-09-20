import { describe, it, expect } from 'vitest';
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
import {
  toAward,
  toGame,
  toLeague,
  toPlayer,
  toPlayoffRound,
  toScore,
  toSeason,
  toSeries,
  toSession,
  toStatistic,
  toTeam,
  toTournament,
  toUser,
} from './mappers.js';

/**
 * Pure row → domain mapper tests. These run without a database — they only
 * exercise the shaping/narrowing logic.
 */
describe('repository mappers', () => {
  it('maps a league row', () => {
    const row: LeagueRow = { id: 'l1', name: 'Metro', createdAt: new Date() };
    expect(toLeague(row)).toEqual({ id: 'l1', name: 'Metro' });
  });

  it('maps a season and omits an absent standings snapshot', () => {
    const start = new Date('2024-01-01');
    const end = new Date('2024-06-01');
    const row: SeasonRow = {
      id: 's1',
      leagueId: 'l1',
      name: '2024',
      startDate: start,
      endDate: end,
      closed: false,
      finalStandingsSnapshot: null,
    };
    const season = toSeason(row);
    expect(season).toEqual({
      id: 's1',
      leagueId: 'l1',
      name: '2024',
      startDate: start,
      endDate: end,
      closed: false,
    });
    expect('finalStandingsSnapshot' in season).toBe(false);
  });

  it('maps a closed season with its snapshot', () => {
    const snapshot = [{ teamId: 't1', wins: 3, losses: 1, rank: 1 }];
    const row: SeasonRow = {
      id: 's1',
      leagueId: 'l1',
      name: '2024',
      startDate: new Date('2024-01-01'),
      endDate: new Date('2024-06-01'),
      closed: true,
      finalStandingsSnapshot: snapshot,
    };
    expect(toSeason(row).finalStandingsSnapshot).toEqual(snapshot);
  });

  it('maps a tournament and omits an absent round-robin kind', () => {
    const row: TournamentRow = {
      id: 'tr1',
      seasonId: 's1',
      format: 'single-elimination',
      roundRobinKind: null,
    };
    const t = toTournament(row);
    expect(t).toEqual({ id: 'tr1', seasonId: 's1', format: 'single-elimination' });
    expect('roundRobinKind' in t).toBe(false);
  });

  it('maps a round-robin tournament with its kind', () => {
    const row: TournamentRow = {
      id: 'tr1',
      seasonId: 's1',
      format: 'round-robin',
      roundRobinKind: 'double',
    };
    expect(toTournament(row).roundRobinKind).toBe('double');
  });

  it('maps team and player rows', () => {
    const teamRow: TeamRow = { id: 't1', seasonId: 's1', name: 'Aces' };
    expect(toTeam(teamRow)).toEqual({ id: 't1', seasonId: 's1', name: 'Aces' });

    const playerRow: PlayerRow = { id: 'p1', teamId: 't1', name: 'Jordan', jerseyNumber: 23 };
    expect(toPlayer(playerRow)).toEqual({
      id: 'p1',
      teamId: 't1',
      name: 'Jordan',
      jerseyNumber: 23,
    });
  });

  it('maps a playoff round and narrows series best-of', () => {
    const roundRow: PlayoffRoundRow = { id: 'r1', seasonId: 's1', type: 'Finals' };
    expect(toPlayoffRound(roundRow)).toEqual({ id: 'r1', seasonId: 's1', type: 'Finals' });

    const seriesRow: SeriesRow = {
      id: 'se1',
      playoffRoundId: 'r1',
      teamAId: 't1',
      teamBId: 't2',
      bestOf: 7,
    };
    const s = toSeries(seriesRow);
    expect(s.bestOf).toBe(7);
    expect(s.teamAId).toBe('t1');
  });

  it('maps a game row including nullable draft fields', () => {
    const date = new Date('2024-02-01T18:00:00Z');
    const row: GameRow = {
      id: 'g1',
      seasonId: 's1',
      homeTeamId: 't1',
      awayTeamId: 't2',
      date,
      startTime: null,
      durationMinutes: null,
      venue: null,
      status: 'scheduled',
      scheduleState: 'draft',
      playoffRoundId: null,
      seriesId: null,
    };
    expect(toGame(row)).toEqual({
      id: 'g1',
      seasonId: 's1',
      homeTeamId: 't1',
      awayTeamId: 't2',
      date,
      startTime: null,
      durationMinutes: null,
      venue: null,
      status: 'scheduled',
      scheduleState: 'draft',
      playoffRoundId: null,
      seriesId: null,
    });
  });

  it('maps score and statistic rows', () => {
    const completedAt = new Date('2024-02-01T20:00:00Z');
    const scoreRow: ScoreRow = { gameId: 'g1', homeScore: 88, awayScore: 84, completedAt };
    expect(toScore(scoreRow)).toEqual({ gameId: 'g1', homeScore: 88, awayScore: 84, completedAt });

    const statRow: StatisticRow = {
      id: 'st1',
      playerId: 'p1',
      gameId: 'g1',
      type: 'Points',
      value: 30,
    };
    expect(toStatistic(statRow)).toEqual({
      id: 'st1',
      playerId: 'p1',
      gameId: 'g1',
      type: 'Points',
      value: 30,
    });
  });

  it('composes a user from base row plus aggregates', () => {
    const at = new Date('2024-01-01T00:00:00Z');
    const row: UserRow = {
      id: 'u1',
      username: 'admin',
      passwordHash: 'hash',
      role: 'Administrator',
      lockedUntil: null,
    };
    const user = toUser(row, ['t1', 't2'], [{ at }]);
    expect(user).toEqual({
      id: 'u1',
      username: 'admin',
      passwordHash: 'hash',
      role: 'Administrator',
      managedTeamIds: ['t1', 't2'],
      failedAttempts: [{ at }],
      lockedUntil: null,
    });
  });

  it('maps a session row', () => {
    const createdAt = new Date('2024-01-01T00:00:00Z');
    const lastActivityAt = new Date('2024-01-01T00:10:00Z');
    const row: SessionRow = {
      id: 'sess1',
      userId: 'u1',
      role: 'Team_Manager',
      createdAt,
      lastActivityAt,
    };
    expect(toSession(row)).toEqual({
      id: 'sess1',
      userId: 'u1',
      role: 'Team_Manager',
      createdAt,
      lastActivityAt,
    });
  });

  it('composes an award from base row plus player ids', () => {
    const row: AwardRow = { id: 'a1', scopeId: 's1', category: 'Mythical_5', published: false };
    const award = toAward(row, ['p1', 'p2', 'p3', 'p4', 'p5']);
    expect(award).toEqual({
      id: 'a1',
      scopeId: 's1',
      category: 'Mythical_5',
      playerIds: ['p1', 'p2', 'p3', 'p4', 'p5'],
      published: false,
    });
  });
});
