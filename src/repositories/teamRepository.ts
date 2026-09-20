/**
 * Team and Player CRUD repositories (data access only).
 *
 * Includes batch inserts (`createMany`) used by the all-or-nothing batch
 * import (Req 11.3) when run inside `withTransaction`, and a
 * `countCompletedGames` read used by the service layer to gate Team deletion
 * (Req 3.7, 3.8). This layer performs no validation beyond database
 * constraints and no business logic.
 *
 * _Requirements: 3.7, 6.1, 11.3_
 */
import { and, count, eq, or } from 'drizzle-orm';
import {
  games,
  players,
  teams,
  type NewPlayerRow,
  type NewTeamRow,
} from '../db/schema.js';
import type { Player, Team } from '../domain/types.js';
import type { Executor } from './executor.js';
import { toPlayer, toTeam } from './mappers.js';

export const teamRepository = {
  async create(input: NewTeamRow, ex: Executor): Promise<Team> {
    const [row] = await ex.insert(teams).values(input).returning();
    return toTeam(row!);
  },

  /** Insert many Teams in one statement (batch import). */
  async createMany(inputs: NewTeamRow[], ex: Executor): Promise<Team[]> {
    if (inputs.length === 0) return [];
    const rows = await ex.insert(teams).values(inputs).returning();
    return rows.map(toTeam);
  },

  async findById(id: string, ex: Executor): Promise<Team | null> {
    const [row] = await ex.select().from(teams).where(eq(teams.id, id)).limit(1);
    return row ? toTeam(row) : null;
  },

  async listBySeason(seasonId: string, ex: Executor): Promise<Team[]> {
    const rows = await ex.select().from(teams).where(eq(teams.seasonId, seasonId));
    return rows.map(toTeam);
  },

  async update(id: string, patch: Partial<NewTeamRow>, ex: Executor): Promise<Team | null> {
    const [row] = await ex.update(teams).set(patch).where(eq(teams.id, id)).returning();
    return row ? toTeam(row) : null;
  },

  /** @returns true if a row was removed. */
  async delete(id: string, ex: Executor): Promise<boolean> {
    const rows = await ex.delete(teams).where(eq(teams.id, id)).returning({ id: teams.id });
    return rows.length > 0;
  },

  /**
   * Count completed Games in which the Team is home or away. Used by the
   * service layer to gate deletion (Req 3.7, 3.8).
   */
  async countCompletedGames(teamId: string, ex: Executor): Promise<number> {
    const [row] = await ex
      .select({ value: count() })
      .from(games)
      .where(
        and(
          eq(games.status, 'completed'),
          or(eq(games.homeTeamId, teamId), eq(games.awayTeamId, teamId)),
        ),
      );
    return row?.value ?? 0;
  },
};

export const playerRepository = {
  async create(input: NewPlayerRow, ex: Executor): Promise<Player> {
    const [row] = await ex.insert(players).values(input).returning();
    return toPlayer(row!);
  },

  /** Insert many Players in one statement (batch import). */
  async createMany(inputs: NewPlayerRow[], ex: Executor): Promise<Player[]> {
    if (inputs.length === 0) return [];
    const rows = await ex.insert(players).values(inputs).returning();
    return rows.map(toPlayer);
  },

  async findById(id: string, ex: Executor): Promise<Player | null> {
    const [row] = await ex.select().from(players).where(eq(players.id, id)).limit(1);
    return row ? toPlayer(row) : null;
  },

  /** All Players on a Team's roster. */
  async listByTeam(teamId: string, ex: Executor): Promise<Player[]> {
    const rows = await ex.select().from(players).where(eq(players.teamId, teamId));
    return rows.map(toPlayer);
  },

  async update(id: string, patch: Partial<NewPlayerRow>, ex: Executor): Promise<Player | null> {
    const [row] = await ex.update(players).set(patch).where(eq(players.id, id)).returning();
    return row ? toPlayer(row) : null;
  },

  /** @returns true if a row was removed. */
  async delete(id: string, ex: Executor): Promise<boolean> {
    const rows = await ex.delete(players).where(eq(players.id, id)).returning({ id: players.id });
    return rows.length > 0;
  },
};
