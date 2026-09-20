/**
 * Award repository (data access only).
 *
 * An {@link Award} spans the `awards` base row and the `award_players` join
 * (one player for most categories, five for Mythical 5). Creating an Award
 * together with its player links is a multi-write; run it inside
 * `withTransaction` so the base row and links are all-or-nothing.
 *
 * No validation beyond database constraints; no business logic.
 *
 * _Requirements: 3.7, 6.1, 11.3_
 */
import { eq } from 'drizzle-orm';
import { awardPlayers, awards, type NewAwardRow } from '../db/schema.js';
import type { Award } from '../domain/types.js';
import type { Executor } from './executor.js';
import { toAward } from './mappers.js';

/** Load the player ids linked to an Award. */
async function loadAwardPlayers(awardId: string, ex: Executor): Promise<string[]> {
  const rows = await ex
    .select({ playerId: awardPlayers.playerId })
    .from(awardPlayers)
    .where(eq(awardPlayers.awardId, awardId));
  return rows.map((r) => r.playerId);
}

export const awardRepository = {
  /**
   * Create an Award and, atomically, its player links. Run inside
   * `withTransaction` to keep the base row and links all-or-nothing.
   */
  async create(input: NewAwardRow, playerIds: string[], ex: Executor): Promise<Award> {
    const [row] = await ex.insert(awards).values(input).returning();
    const created = row!;
    if (playerIds.length > 0) {
      await ex
        .insert(awardPlayers)
        .values(playerIds.map((playerId) => ({ awardId: created.id, playerId })));
    }
    return toAward(created, playerIds);
  },

  async findById(id: string, ex: Executor): Promise<Award | null> {
    const [row] = await ex.select().from(awards).where(eq(awards.id, id)).limit(1);
    if (!row) return null;
    const playerIds = await loadAwardPlayers(row.id, ex);
    return toAward(row, playerIds);
  },

  /** All Awards for a Season/Tournament scope. */
  async listByScope(scopeId: string, ex: Executor): Promise<Award[]> {
    const rows = await ex.select().from(awards).where(eq(awards.scopeId, scopeId));
    const out: Award[] = [];
    for (const row of rows) {
      const playerIds = await loadAwardPlayers(row.id, ex);
      out.push(toAward(row, playerIds));
    }
    return out;
  },

  /** Mark an Award published so Viewers can see it (Req 13.13–13.15). */
  async setPublished(id: string, published: boolean, ex: Executor): Promise<Award | null> {
    const [row] = await ex.update(awards).set({ published }).where(eq(awards.id, id)).returning();
    if (!row) return null;
    const playerIds = await loadAwardPlayers(row.id, ex);
    return toAward(row, playerIds);
  },

  /** @returns true if a row was removed. */
  async delete(id: string, ex: Executor): Promise<boolean> {
    const rows = await ex.delete(awards).where(eq(awards.id, id)).returning({ id: awards.id });
    return rows.length > 0;
  },
};
