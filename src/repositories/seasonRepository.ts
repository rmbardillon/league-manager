/**
 * Season and Tournament CRUD repositories (data access only).
 *
 * _Requirements: 3.7, 6.1, 11.3_
 */
import { eq } from 'drizzle-orm';
import {
  seasons,
  tournaments,
  type NewSeasonRow,
  type NewTournamentRow,
} from '../db/schema.js';
import type { Season, StandingRow, Tournament } from '../domain/types.js';
import type { Executor } from './executor.js';
import { toSeason, toTournament } from './mappers.js';

export const seasonRepository = {
  async create(input: NewSeasonRow, ex: Executor): Promise<Season> {
    const [row] = await ex.insert(seasons).values(input).returning();
    return toSeason(row!);
  },

  async findById(id: string, ex: Executor): Promise<Season | null> {
    const [row] = await ex.select().from(seasons).where(eq(seasons.id, id)).limit(1);
    return row ? toSeason(row) : null;
  },

  async listByLeague(leagueId: string, ex: Executor): Promise<Season[]> {
    const rows = await ex.select().from(seasons).where(eq(seasons.leagueId, leagueId));
    return rows.map(toSeason);
  },

  async update(id: string, patch: Partial<NewSeasonRow>, ex: Executor): Promise<Season | null> {
    const [row] = await ex.update(seasons).set(patch).where(eq(seasons.id, id)).returning();
    return row ? toSeason(row) : null;
  },

  /** Mark the Season closed and persist its final standings snapshot (Req 10.5). */
  async close(id: string, snapshot: StandingRow[], ex: Executor): Promise<Season | null> {
    const [row] = await ex
      .update(seasons)
      .set({ closed: true, finalStandingsSnapshot: snapshot })
      .where(eq(seasons.id, id))
      .returning();
    return row ? toSeason(row) : null;
  },

  /** @returns true if a row was removed. */
  async delete(id: string, ex: Executor): Promise<boolean> {
    const rows = await ex.delete(seasons).where(eq(seasons.id, id)).returning({ id: seasons.id });
    return rows.length > 0;
  },
};

export const tournamentRepository = {
  async create(input: NewTournamentRow, ex: Executor): Promise<Tournament> {
    const [row] = await ex.insert(tournaments).values(input).returning();
    return toTournament(row!);
  },

  async findById(id: string, ex: Executor): Promise<Tournament | null> {
    const [row] = await ex.select().from(tournaments).where(eq(tournaments.id, id)).limit(1);
    return row ? toTournament(row) : null;
  },

  async listBySeason(seasonId: string, ex: Executor): Promise<Tournament[]> {
    const rows = await ex.select().from(tournaments).where(eq(tournaments.seasonId, seasonId));
    return rows.map(toTournament);
  },

  async update(
    id: string,
    patch: Partial<NewTournamentRow>,
    ex: Executor,
  ): Promise<Tournament | null> {
    const [row] = await ex.update(tournaments).set(patch).where(eq(tournaments.id, id)).returning();
    return row ? toTournament(row) : null;
  },

  /** @returns true if a row was removed. */
  async delete(id: string, ex: Executor): Promise<boolean> {
    const rows = await ex
      .delete(tournaments)
      .where(eq(tournaments.id, id))
      .returning({ id: tournaments.id });
    return rows.length > 0;
  },
};
