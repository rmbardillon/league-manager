import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock the DB client so importing the repository barrel never opens a real
// postgres connection. The AwardsService only needs a Database whose
// `transaction` runs the work callback; we inject a stub below.
vi.mock('../db/client.js', () => ({
  sql: {},
  db: {},
}));

import { createAwardsService } from './awardsService.js';
import type {
  Award,
  Game,
  PlayoffRound,
  RosterAssignment,
  Score,
  Series,
  Statistic,
} from '../domain/types.js';
import type { Database, Transaction } from '../repositories/executor.js';
import {
  awardRepository,
  gameRepository,
  playerRepository,
  playoffRoundRepository,
  rosterAssignmentRepository,
  scoreRepository,
  seriesRepository,
  statisticRepository,
} from '../repositories/index.js';

/**
 * AwardsService Finals-MVP candidate-pool unit test (Req 6.2, identity Req 6.1).
 *
 * Exercised DB-less: `db.transaction` is stubbed to invoke the callback with a
 * marker transaction, and every repository the service touches is spied so the
 * `computeAwards` finals path runs end-to-end without a database.
 *
 * The scenario wires a scope (Season `s-1`) with a Finals Playoff_Round, a
 * decided best-of-1 Series between a champion Team and a loser Team, one
 * completed Finals Game the champion wins, Finals Statistics for the champion
 * Team's players, and the champion Team's Roster_Assignments. It asserts the
 * Finals-MVP candidate pool is derived from the champion Team's assignments
 * (via `rosterAssignmentRepository.listByTeam(championTeamId)`, NOT the removed
 * `playerRepository.listByTeam`), that each assignment's master name is
 * resolved via `playerRepository.findById`, and that the persisted Finals_MVP
 * award's `playerId` is one of those assigned players' MASTER ids — confirming
 * award recipients remain master-Player ids (identity preserved).
 */

const MARKER_TX = { marker: 'tx' } as unknown as Transaction;

/** A Database whose transaction runs the callback with the marker tx. */
function stubDb(): Database {
  const transaction = vi.fn(async (work: (t: Transaction) => Promise<unknown>) =>
    work(MARKER_TX),
  );
  return { transaction } as unknown as Database;
}

// --- Fixture ids -----------------------------------------------------------
const SCOPE_ID = 's-1';
const FINALS_ROUND_ID = 'r-finals';
const SERIES_ID = 'ser-1';
const CHAMP_TEAM_ID = 't-champ';
const LOSER_TEAM_ID = 't-loser';
const FINALS_GAME_ID = 'g-finals-1';

// Champion Team master-player ids (these live on roster assignments as
// `playerId`, and must be what award recipients resolve to).
const CHAMP_PLAYER_STAR = 'p-star'; // highest Finals TSP → expected Finals MVP
const CHAMP_PLAYER_BENCH = 'p-bench';

function finalsRound(): PlayoffRound {
  return { id: FINALS_ROUND_ID, seasonId: SCOPE_ID, type: 'Finals' };
}

function series(): Series {
  return {
    id: SERIES_ID,
    playoffRoundId: FINALS_ROUND_ID,
    teamAId: CHAMP_TEAM_ID,
    teamBId: LOSER_TEAM_ID,
    bestOf: 1,
  };
}

/** A completed Finals Game the champion (home) wins. */
function finalsGame(): Game {
  return {
    id: FINALS_GAME_ID,
    seasonId: SCOPE_ID,
    homeTeamId: CHAMP_TEAM_ID,
    awayTeamId: LOSER_TEAM_ID,
    date: new Date('2024-06-01T00:00:00.000Z'),
    startTime: '19:00',
    durationMinutes: 48,
    venue: 'Arena',
    status: 'completed',
    scheduleState: 'official',
    playoffRoundId: FINALS_ROUND_ID,
    seriesId: SERIES_ID,
  };
}

function finalsScore(): Score {
  return {
    gameId: FINALS_GAME_ID,
    homeScore: 101, // champion (home) wins
    awayScore: 88,
    completedAt: new Date('2024-06-01T22:00:00.000Z'),
  };
}

/** Champion Team roster assignments (master ids on `playerId`). */
function championAssignments(): RosterAssignment[] {
  return [
    { id: 'a-star', playerId: CHAMP_PLAYER_STAR, teamId: CHAMP_TEAM_ID, jerseyNumber: 23 },
    { id: 'a-bench', playerId: CHAMP_PLAYER_BENCH, teamId: CHAMP_TEAM_ID, jerseyNumber: 7 },
  ];
}

/**
 * Finals Statistics: the star player accrues more Total_Statistics_Points
 * (Points + Assists + Rebounds + Steals + Blocks) than the bench player, so
 * `computeFinalsMvp` must pick the star.
 */
function finalsStatistics(): Statistic[] {
  return [
    { id: 'st-1', playerId: CHAMP_PLAYER_STAR, gameId: FINALS_GAME_ID, type: 'Points', value: 40 },
    { id: 'st-2', playerId: CHAMP_PLAYER_STAR, gameId: FINALS_GAME_ID, type: 'Assists', value: 10 },
    { id: 'st-3', playerId: CHAMP_PLAYER_BENCH, gameId: FINALS_GAME_ID, type: 'Points', value: 4 },
  ];
}

/** Resolve a master player's name by id (what `playerRepository.findById` returns). */
const MASTER_NAMES: Record<string, string> = {
  [CHAMP_PLAYER_STAR]: 'Star Player',
  [CHAMP_PLAYER_BENCH]: 'Bench Player',
};

describe('AwardsService.computeAwards — Finals MVP candidate pool (Req 6.2, 6.1)', () => {
  beforeEach(() => {
    // listBySeason returns only the Finals game (no regular-season games), so
    // the regular-season awards path yields no awards and only the Finals_MVP
    // award is produced.
    vi.spyOn(gameRepository, 'listBySeason').mockResolvedValue([finalsGame()]);
    vi.spyOn(statisticRepository, 'listByGame').mockResolvedValue(finalsStatistics());
    vi.spyOn(playoffRoundRepository, 'listBySeason').mockResolvedValue([finalsRound()]);
    vi.spyOn(scoreRepository, 'findByGame').mockResolvedValue(finalsScore());
    vi.spyOn(seriesRepository, 'listByRound').mockResolvedValue([series()]);

    vi
      .spyOn(playerRepository, 'findById')
      .mockImplementation(async (id: string) =>
        id in MASTER_NAMES ? { id, name: MASTER_NAMES[id]! } : null,
      );

    // No pre-existing awards to clear.
    vi.spyOn(awardRepository, 'listByScope').mockResolvedValue([]);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('derives the champion candidate pool from the champion Team assignments and awards a master-player id', async () => {
    const listByTeam = vi
      .spyOn(rosterAssignmentRepository, 'listByTeam')
      .mockResolvedValue(championAssignments());

    // Capture the persisted Finals_MVP award.
    const create = vi
      .spyOn(awardRepository, 'create')
      .mockImplementation(async (input, playerIds): Promise<Award> => {
        return {
          id: `award-${input.category}`,
          scopeId: input.scopeId,
          category: input.category,
          playerIds: [...playerIds],
          published: input.published ?? false,
        };
      });

    const svc = createAwardsService(stubDb());
    const result = await svc.computeAwards(SCOPE_ID);

    // --- The candidate pool comes from the champion Team's assignments -------
    // (Req 6.2) — looked up by the champion Team id, never the loser's.
    expect(listByTeam).toHaveBeenCalledWith(CHAMP_TEAM_ID, MARKER_TX);
    expect(listByTeam).not.toHaveBeenCalledWith(LOSER_TEAM_ID, expect.anything());

    // Each assignment's master name is resolved via the master player repo.
    expect(playerRepository.findById).toHaveBeenCalledWith(CHAMP_PLAYER_STAR, MARKER_TX);
    expect(playerRepository.findById).toHaveBeenCalledWith(CHAMP_PLAYER_BENCH, MARKER_TX);

    // --- A Finals_MVP award was persisted ------------------------------------
    expect(result.finalsMvpAvailable).toBe(true);
    const finalsCreateCall = create.mock.calls.find(
      ([input]) => input.category === 'Finals_MVP',
    );
    expect(finalsCreateCall).toBeDefined();

    const [, finalsPlayerIds] = finalsCreateCall!;
    expect(finalsPlayerIds).toHaveLength(1);
    const awardedPlayerId = finalsPlayerIds[0]!;

    // --- Identity: the award recipient is a champion-team assignment's master
    // player id (Req 6.1), and specifically the derived pool's standout. ------
    const championMasterIds = championAssignments().map((a) => a.playerId);
    expect(championMasterIds).toContain(awardedPlayerId);
    expect(awardedPlayerId).toBe(CHAMP_PLAYER_STAR);

    // The persisted award in the result carries the same master-player id.
    const finalsAward = result.awards.find((a) => a.category === 'Finals_MVP');
    expect(finalsAward?.playerIds).toEqual([CHAMP_PLAYER_STAR]);
  });
});
