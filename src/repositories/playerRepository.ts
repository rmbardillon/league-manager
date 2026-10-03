/**
 * Master Player CRUD repository (data access only).
 *
 * A Player is now a master record `{ id, name }` — a person, decoupled from any
 * Team or jersey. Team membership lives in `roster_assignments` and is served
 * by `rosterAssignmentRepository`. This layer performs no validation beyond
 * database constraints and no business logic.
 *
 * `createMany` supports the all-or-nothing batch import (Req 8.1) when run
 * inside `withTransaction`; `list` backs the administrator Player listing
 * (Req 1.7).
 *
 * _Requirements: 1.1, 1.4, 1.5, 1.7, 1.9_
 */
import { eq } from 'drizzle-orm';
import { players } from '../db/schema.js';
import type { Player } from '../domain/types.js';
import type { Executor } from './executor.js';
import { toPlayer } from './mappers.js';

export const playerRepository = {
  async create(input: { name: string }, ex: Executor): Promise<Player> {
    const [row] = await ex.insert(players).values(input).returning();
    return toPlayer(row!);
  },

  /** Insert many master Players in one statement (batch import). */
  async createMany(inputs: { name: string }[], ex: Executor): Promise<Player[]> {
    if (inputs.length === 0) return [];
    const rows = await ex.insert(players).values(inputs).returning();
    return rows.map(toPlayer);
  },

  async findById(id: string, ex: Executor): Promise<Player | null> {
    const [row] = await ex.select().from(players).where(eq(players.id, id)).limit(1);
    return row ? toPlayer(row) : null;
  },

  /** All master Players (Req 1.7). */
  async list(ex: Executor): Promise<Player[]> {
    const rows = await ex.select().from(players);
    return rows.map(toPlayer);
  },

  async update(
    id: string,
    patch: { name?: string },
    ex: Executor,
  ): Promise<Player | null> {
    const [row] = await ex.update(players).set(patch).where(eq(players.id, id)).returning();
    return row ? toPlayer(row) : null;
  },

  /** @returns true if a row was removed. */
  async delete(id: string, ex: Executor): Promise<boolean> {
    const rows = await ex.delete(players).where(eq(players.id, id)).returning({ id: players.id });
    return rows.length > 0;
  },
};
