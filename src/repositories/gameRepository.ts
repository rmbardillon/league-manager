/**
 * Game, Score, and Statistic CRUD repositories (data access only).
 *
 * The Score/Game pair is the canonical multi-write use case (Req 6.1):
 * recording a Score also marks its Game completed. Callers combine
 * `scoreRepository.upsert` + `gameRepository.setStatus` inside
 * `withTransaction` so both land atomically. This layer performs no
 * validation beyond database constraints and no business logic.
 *
 * _Requirements: 3.7, 6.1, 11.3_
 */
import { and, eq } from 'drizzle-orm';
import {
  games,
  scores,
  statistics,
  type NewGameRow,
  type NewScoreRow,
  type NewStatisticRow,
} from '../db/schema.js';
import type { Game, GameStatus, Score, Statistic, StatisticType } from '../domain/types.js';
import type { Executor } from './executor.js';
import { toGame, toScore, toStatistic } from './mappers.js';

export const gameRepository = {
  async create(input: NewGameRow, ex: Executor): Promise<Game> {
    const [row] = await ex.insert(games).values(input).returning();
    return toGame(row!);
  },

  /** Insert many Games in one statement (draft schedule generation / batch). */
  async createMany(inputs: NewGameRow[], ex: Executor): Promise<Game[]> {
    if (inputs.length === 0) return [];
    const rows = await ex.insert(games).values(inputs).returning();
    return rows.map(toGame);
  },

  async findById(id: string, ex: Executor): Promise<Game | null> {
    const [row] = await ex.select().from(games).where(eq(games.id, id)).limit(1);
    return row ? toGame(row) : null;
  },

  async listBySeason(seasonId: string, ex: Executor): Promise<Game[]> {
    const rows = await ex.select().from(games).where(eq(games.seasonId, seasonId));
    return rows.map(toGame);
  },

  async update(id: string, patch: Partial<NewGameRow>, ex: Executor): Promise<Game | null> {
    const [row] = await ex.update(games).set(patch).where(eq(games.id, id)).returning();
    return row ? toGame(row) : null;
  },

  /** Set only the lifecycle status (e.g. mark completed with a Score, or cancel). */
  async setStatus(id: string, status: GameStatus, ex: Executor): Promise<Game | null> {
    const [row] = await ex.update(games).set({ status }).where(eq(games.id, id)).returning();
    return row ? toGame(row) : null;
  },

  /** @returns true if a row was removed. */
  async delete(id: string, ex: Executor): Promise<boolean> {
    const rows = await ex.delete(games).where(eq(games.id, id)).returning({ id: games.id });
    return rows.length > 0;
  },
};

export const scoreRepository = {
  /**
   * Insert or replace the Score for a Game (score correction reuses the same
   * primary key). Pair with `gameRepository.setStatus(..., 'completed')`
   * inside a transaction for the record-Score use case (Req 6.1).
   */
  async upsert(input: NewScoreRow, ex: Executor): Promise<Score> {
    const [row] = await ex
      .insert(scores)
      .values(input)
      .onConflictDoUpdate({
        target: scores.gameId,
        set: {
          homeScore: input.homeScore,
          awayScore: input.awayScore,
          completedAt: input.completedAt,
        },
      })
      .returning();
    return toScore(row!);
  },

  async findByGame(gameId: string, ex: Executor): Promise<Score | null> {
    const [row] = await ex.select().from(scores).where(eq(scores.gameId, gameId)).limit(1);
    return row ? toScore(row) : null;
  },

  /** @returns true if a row was removed. */
  async delete(gameId: string, ex: Executor): Promise<boolean> {
    const rows = await ex
      .delete(scores)
      .where(eq(scores.gameId, gameId))
      .returning({ gameId: scores.gameId });
    return rows.length > 0;
  },
};

export const statisticRepository = {
  async create(input: NewStatisticRow, ex: Executor): Promise<Statistic> {
    const [row] = await ex.insert(statistics).values(input).returning();
    return toStatistic(row!);
  },

  /** Insert many Statistics in one statement (batch import). */
  async createMany(inputs: NewStatisticRow[], ex: Executor): Promise<Statistic[]> {
    if (inputs.length === 0) return [];
    const rows = await ex.insert(statistics).values(inputs).returning();
    return rows.map(toStatistic);
  },

  /**
   * Insert or replace a single (player, game, type) statistic value, matching
   * the `statistics_player_game_type_uq` constraint.
   */
  async upsert(input: NewStatisticRow, ex: Executor): Promise<Statistic> {
    const [row] = await ex
      .insert(statistics)
      .values(input)
      .onConflictDoUpdate({
        target: [statistics.playerId, statistics.gameId, statistics.type],
        set: { value: input.value },
      })
      .returning();
    return toStatistic(row!);
  },

  async listByGame(gameId: string, ex: Executor): Promise<Statistic[]> {
    const rows = await ex.select().from(statistics).where(eq(statistics.gameId, gameId));
    return rows.map(toStatistic);
  },

  async listByPlayer(playerId: string, ex: Executor): Promise<Statistic[]> {
    const rows = await ex.select().from(statistics).where(eq(statistics.playerId, playerId));
    return rows.map(toStatistic);
  },

  async findOne(
    playerId: string,
    gameId: string,
    type: StatisticType,
    ex: Executor,
  ): Promise<Statistic | null> {
    const [row] = await ex
      .select()
      .from(statistics)
      .where(
        and(
          eq(statistics.playerId, playerId),
          eq(statistics.gameId, gameId),
          eq(statistics.type, type),
        ),
      )
      .limit(1);
    return row ? toStatistic(row) : null;
  },

  /** @returns true if a row was removed. */
  async delete(id: string, ex: Executor): Promise<boolean> {
    const rows = await ex
      .delete(statistics)
      .where(eq(statistics.id, id))
      .returning({ id: statistics.id });
    return rows.length > 0;
  },
};
