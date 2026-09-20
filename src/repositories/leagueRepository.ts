/**
 * League CRUD repository (data access only).
 *
 * _Requirements: 3.7, 6.1, 11.3_
 */
import { eq } from 'drizzle-orm';
import { leagues, type NewLeagueRow } from '../db/schema.js';
import type { League } from '../domain/types.js';
import type { Executor } from './executor.js';
import { toLeague } from './mappers.js';

export const leagueRepository = {
  async create(input: NewLeagueRow, ex: Executor): Promise<League> {
    const [row] = await ex.insert(leagues).values(input).returning();
    return toLeague(row!);
  },

  async findById(id: string, ex: Executor): Promise<League | null> {
    const [row] = await ex.select().from(leagues).where(eq(leagues.id, id)).limit(1);
    return row ? toLeague(row) : null;
  },

  async list(ex: Executor): Promise<League[]> {
    const rows = await ex.select().from(leagues);
    return rows.map(toLeague);
  },

  async update(id: string, patch: Partial<NewLeagueRow>, ex: Executor): Promise<League | null> {
    const [row] = await ex.update(leagues).set(patch).where(eq(leagues.id, id)).returning();
    return row ? toLeague(row) : null;
  },

  /** @returns true if a row was removed. */
  async delete(id: string, ex: Executor): Promise<boolean> {
    const rows = await ex.delete(leagues).where(eq(leagues.id, id)).returning({ id: leagues.id });
    return rows.length > 0;
  },
};
