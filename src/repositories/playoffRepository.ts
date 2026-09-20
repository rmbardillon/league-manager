/**
 * PlayoffRound and Series CRUD repositories (data access only).
 *
 * _Requirements: 3.7, 6.1, 11.3_
 */
import { eq } from 'drizzle-orm';
import {
  playoffRounds,
  series,
  type NewPlayoffRoundRow,
  type NewSeriesRow,
} from '../db/schema.js';
import type { PlayoffRound, Series } from '../domain/types.js';
import type { Executor } from './executor.js';
import { toPlayoffRound, toSeries } from './mappers.js';

export const playoffRoundRepository = {
  async create(input: NewPlayoffRoundRow, ex: Executor): Promise<PlayoffRound> {
    const [row] = await ex.insert(playoffRounds).values(input).returning();
    return toPlayoffRound(row!);
  },

  async findById(id: string, ex: Executor): Promise<PlayoffRound | null> {
    const [row] = await ex.select().from(playoffRounds).where(eq(playoffRounds.id, id)).limit(1);
    return row ? toPlayoffRound(row) : null;
  },

  async listBySeason(seasonId: string, ex: Executor): Promise<PlayoffRound[]> {
    const rows = await ex.select().from(playoffRounds).where(eq(playoffRounds.seasonId, seasonId));
    return rows.map(toPlayoffRound);
  },

  async update(
    id: string,
    patch: Partial<NewPlayoffRoundRow>,
    ex: Executor,
  ): Promise<PlayoffRound | null> {
    const [row] = await ex
      .update(playoffRounds)
      .set(patch)
      .where(eq(playoffRounds.id, id))
      .returning();
    return row ? toPlayoffRound(row) : null;
  },

  /** @returns true if a row was removed. */
  async delete(id: string, ex: Executor): Promise<boolean> {
    const rows = await ex
      .delete(playoffRounds)
      .where(eq(playoffRounds.id, id))
      .returning({ id: playoffRounds.id });
    return rows.length > 0;
  },
};

export const seriesRepository = {
  async create(input: NewSeriesRow, ex: Executor): Promise<Series> {
    const [row] = await ex.insert(series).values(input).returning();
    return toSeries(row!);
  },

  async findById(id: string, ex: Executor): Promise<Series | null> {
    const [row] = await ex.select().from(series).where(eq(series.id, id)).limit(1);
    return row ? toSeries(row) : null;
  },

  async listByRound(playoffRoundId: string, ex: Executor): Promise<Series[]> {
    const rows = await ex.select().from(series).where(eq(series.playoffRoundId, playoffRoundId));
    return rows.map(toSeries);
  },

  async update(id: string, patch: Partial<NewSeriesRow>, ex: Executor): Promise<Series | null> {
    const [row] = await ex.update(series).set(patch).where(eq(series.id, id)).returning();
    return row ? toSeries(row) : null;
  },

  /** @returns true if a row was removed. */
  async delete(id: string, ex: Executor): Promise<boolean> {
    const rows = await ex.delete(series).where(eq(series.id, id)).returning({ id: series.id });
    return rows.length > 0;
  },
};
