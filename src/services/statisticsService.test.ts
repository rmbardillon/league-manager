import { describe, it, expect, vi } from 'vitest';
import fc from 'fast-check';

import { StatisticsService } from './statisticsService.js';
import { ValidationError } from '../domain/errors.js';
import { StatisticTypes } from '../domain/types.js';
import type { Game, RosterAssignment, Statistic } from '../domain/types.js';
import type { Database, Transaction } from '../repositories/executor.js';
import {
  gameRepository,
  rosterAssignmentRepository,
  statisticRepository,
  teamRepository,
} from '../repositories/index.js';

/**
 * StatisticsService property tests (DB-less).
 *
 * These exercise the service without a real database, mirroring
 * `batchUploadService.test.ts`: the live Drizzle client is mocked so importing
 * the repositories never opens a connection, `db.transaction` is stubbed to run
 * the callback with a marker transaction, and the Game / Roster_Assignment /
 * Statistic / Team repositories are spied so we can drive and observe behaviour.
 *
 * Statistics eligibility and aggregation are now derived from Roster_Assignments
 * (the master-Player model). These properties verify the two assignment-driven
 * behaviours of the reconciled service:
 *   - recordStatistic treats a Player as eligible iff an assignment places them
 *     on the Game's home or away Team (Req 5.2, 5.3).
 *   - getTeamSeasonStats attributes a Player's stats to a Team iff an assignment
 *     places them on that Team (Req 5.4).
 */

// Avoid opening a real postgres connection when the repository barrel is
// imported transitively — the service only uses the injected `db` handle.
vi.mock('../db/client.js', () => ({
  sql: {},
  db: {},
}));

/** A Database whose `transaction` runs the callback with a marker tx. */
function stubDb(): Database {
  const tx = { marker: 'tx' } as unknown as Transaction;
  const transaction = vi.fn(async (work: (t: Transaction) => Promise<unknown>) =>
    work(tx),
  );
  return { transaction } as unknown as Database;
}

/** Build a minimal completed Game for a Season with the two given Teams. */
function makeGame(
  seasonId: string,
  homeTeamId: string,
  awayTeamId: string,
): Game {
  return {
    id: 'g-1',
    seasonId,
    homeTeamId,
    awayTeamId,
    date: new Date('2024-01-01T00:00:00.000Z'),
    startTime: null,
    durationMinutes: null,
    venue: null,
    status: 'completed',
    scheduleState: 'official',
    playoffRoundId: null,
    seriesId: null,
  };
}

/** Build a Roster_Assignment row (id is irrelevant to the service logic). */
function makeAssignment(
  playerId: string,
  teamId: string,
  jerseyNumber: number,
): RosterAssignment {
  return { id: `a-${playerId}-${teamId}`, playerId, teamId, jerseyNumber };
}

const HOME_TEAM = 't-home';
const AWAY_TEAM = 't-away';
const SEASON = 's-1';

/** Generator for one of the six supported Statistic_Type values. */
const statisticTypeArb = fc.constantFrom(...StatisticTypes);

/** Generator for a valid Statistic value (non-negative integer, 0–999). */
const validValueArb = fc.integer({ min: 0, max: 999 });

/** Generator for a distinct player id. */
const playerIdArb = fc
  .integer({ min: 0, max: 10_000 })
  .map((n) => `p-${n}`);

describe('StatisticsService — assignment-driven statistics (property-based)', () => {
  // Feature: player-master-data, Property 10: recordStatistic upserts the Statistic iff the Player holds a Roster_Assignment to the Game's home or away Team (otherwise it throws a ValidationError and writes nothing)
  it('Property 10: assignment-based eligibility gates recordStatistic', async () => {
    await fc.assert(
      fc.asyncProperty(
        playerIdArb,
        // The Team the Player is assigned to, if any: home, away, an unrelated
        // Team, or no assignment at all. Only home/away make them eligible.
        fc.constantFrom<'home' | 'away' | 'other' | 'none'>(
          'home',
          'away',
          'other',
          'none',
        ),
        statisticTypeArb,
        validValueArb,
        fc.integer({ min: 0, max: 99 }),
        async (playerId, placement, type, value, jersey) => {
          const game = makeGame(SEASON, HOME_TEAM, AWAY_TEAM);

          // Roster membership of the two participating Teams, driven by the
          // Player's placement. `listByTeam` returns the assignments per Team.
          const homeRoster: RosterAssignment[] = [];
          const awayRoster: RosterAssignment[] = [];
          if (placement === 'home') {
            homeRoster.push(makeAssignment(playerId, HOME_TEAM, jersey));
          } else if (placement === 'away') {
            awayRoster.push(makeAssignment(playerId, AWAY_TEAM, jersey));
          }
          // 'other' / 'none': the Player is absent from both participating
          // Teams' rosters, so the pure validator deems them ineligible.

          const eligible = placement === 'home' || placement === 'away';

          const findById = vi
            .spyOn(gameRepository, 'findById')
            .mockResolvedValue(game);
          const listByTeam = vi
            .spyOn(rosterAssignmentRepository, 'listByTeam')
            .mockImplementation(async (teamId: string) => {
              if (teamId === HOME_TEAM) return homeRoster;
              if (teamId === AWAY_TEAM) return awayRoster;
              return [];
            });
          const upsert = vi
            .spyOn(statisticRepository, 'upsert')
            .mockImplementation(async (input) => ({
              id: 'stat-1',
              playerId: input.playerId,
              gameId: input.gameId,
              type: input.type,
              value: input.value,
            }));

          try {
            const svc = new StatisticsService(stubDb());
            const call = svc.recordStatistic({
              playerId,
              gameId: game.id,
              type,
              value,
            });

            if (eligible) {
              const stat = await call;
              // An eligible Player with a valid type/value is persisted exactly
              // once via upsert, carrying the recorded value.
              expect(upsert).toHaveBeenCalledTimes(1);
              expect(upsert.mock.calls[0]![0]).toEqual({
                playerId,
                gameId: game.id,
                type,
                value,
              });
              expect(stat.value).toBe(value);
            } else {
              // An ineligible Player is rejected with a ValidationError and
              // nothing is written.
              await expect(call).rejects.toBeInstanceOf(ValidationError);
              expect(upsert).not.toHaveBeenCalled();
            }
          } finally {
            findById.mockRestore();
            listByTeam.mockRestore();
            upsert.mockRestore();
          }
        },
      ),
      { numRuns: 100 },
    );
  });

  // Feature: player-master-data, Property 11: getTeamSeasonStats attributes a Player's recorded values to the Team iff the Player holds a Roster_Assignment to that Team; stats of unassigned Players never contribute to the Team total
  it('Property 11: assignment-based aggregation attribution for getTeamSeasonStats', async () => {
    await fc.assert(
      fc.asyncProperty(
        // An assigned Player (on the queried Team) with a recorded value.
        playerIdArb,
        statisticTypeArb,
        validValueArb,
        // An unassigned Player (not on the queried Team) with a recorded value.
        playerIdArb,
        validValueArb,
        async (
          assignedId,
          type,
          assignedValue,
          unassignedId,
          unassignedValue,
        ) => {
          // Keep the two players distinct so the aggregation attribution is
          // unambiguous.
          fc.pre(assignedId !== unassignedId);

          const game = makeGame(SEASON, HOME_TEAM, AWAY_TEAM);

          const teamRoster = [makeAssignment(assignedId, HOME_TEAM, 10)];

          const seasonStats: Statistic[] = [
            {
              id: 'stat-assigned',
              playerId: assignedId,
              gameId: game.id,
              type,
              value: assignedValue,
            },
            {
              id: 'stat-unassigned',
              playerId: unassignedId,
              gameId: game.id,
              type,
              value: unassignedValue,
            },
          ];

          const teamFindById = vi
            .spyOn(teamRepository, 'findById')
            .mockResolvedValue({
              id: HOME_TEAM,
              seasonId: SEASON,
              name: 'Home',
            });
          // getTeamSeasonStats builds the roster from listByTeam(teamId): only
          // the assigned Player is on the queried Team.
          const listByTeam = vi
            .spyOn(rosterAssignmentRepository, 'listByTeam')
            .mockImplementation(async (teamId: string) =>
              teamId === HOME_TEAM ? teamRoster : [],
            );
          const listBySeason = vi
            .spyOn(gameRepository, 'listBySeason')
            .mockResolvedValue([game]);
          const listByGame = vi
            .spyOn(statisticRepository, 'listByGame')
            .mockResolvedValue(seasonStats);

          try {
            const svc = new StatisticsService(stubDb());
            const totals = await svc.getTeamSeasonStats(SEASON, HOME_TEAM);

            // The queried type sums only the assigned Player's value; the
            // unassigned Player never contributes to the Team total.
            expect(totals[type]).toBe(assignedValue);

            // Every other type is zero (only `type` was recorded).
            for (const t of StatisticTypes) {
              if (t !== type) {
                expect(totals[t]).toBe(0);
              }
            }
          } finally {
            teamFindById.mockRestore();
            listByTeam.mockRestore();
            listBySeason.mockRestore();
            listByGame.mockRestore();
          }
        },
      ),
      { numRuns: 100 },
    );
  });
});
