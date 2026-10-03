/**
 * Roster_Assignment repository (data access only).
 *
 * A {@link RosterAssignment} links one master Player to one Team (and, since a
 * Team belongs to exactly one Season, to one Season) with a jersey number.
 * This layer is the counterpart to the master `playerRepository`: the Team
 * membership and jersey that used to live on `players` now live here.
 *
 * No validation beyond database constraints (jersey range, jersey uniqueness
 * within a Team) and no business logic. The one-assignment-per-Player-per-
 * Season rule has no single-table DB expression — the Season is reached via
 * `teams.season_id` — so it is enforced in the service layer, which reads the
 * Player's same-Season assignments through {@link listByPlayerInSeason}.
 *
 * _Requirements: 2.1, 3.2, 4.1, 4.3, 5.4_
 */
import { and, eq } from 'drizzle-orm';
import { rosterAssignments, teams, type NewRosterAssignmentRow } from '../db/schema.js';
import type { RosterAssignment } from '../domain/types.js';
import type { Executor } from './executor.js';
import { toRosterAssignment } from './mappers.js';

/** The data needed to create a single roster assignment. */
export type RosterAssignmentInput = {
  playerId: string;
  teamId: string;
  jerseyNumber: number;
};

export const rosterAssignmentRepository = {
  async create(input: RosterAssignmentInput, ex: Executor): Promise<RosterAssignment> {
    const [row] = await ex
      .insert(rosterAssignments)
      .values(input satisfies NewRosterAssignmentRow)
      .returning();
    return toRosterAssignment(row!);
  },

  /** Insert many assignments in one statement (batch import). */
  async createMany(
    inputs: RosterAssignmentInput[],
    ex: Executor,
  ): Promise<RosterAssignment[]> {
    if (inputs.length === 0) return [];
    const rows = await ex
      .insert(rosterAssignments)
      .values(inputs satisfies NewRosterAssignmentRow[])
      .returning();
    return rows.map(toRosterAssignment);
  },

  /** The Player's assignment to a specific Team, if any. */
  async findByPlayerAndTeam(
    playerId: string,
    teamId: string,
    ex: Executor,
  ): Promise<RosterAssignment | null> {
    const [row] = await ex
      .select()
      .from(rosterAssignments)
      .where(
        and(
          eq(rosterAssignments.playerId, playerId),
          eq(rosterAssignments.teamId, teamId),
        ),
      )
      .limit(1);
    return row ? toRosterAssignment(row) : null;
  },

  /** Every assignment on a Team (its roster). */
  async listByTeam(teamId: string, ex: Executor): Promise<RosterAssignment[]> {
    const rows = await ex
      .select()
      .from(rosterAssignments)
      .where(eq(rosterAssignments.teamId, teamId));
    return rows.map(toRosterAssignment);
  },

  /** Every assignment a Player holds across Teams/Seasons (their history). */
  async listByPlayer(playerId: string, ex: Executor): Promise<RosterAssignment[]> {
    const rows = await ex
      .select()
      .from(rosterAssignments)
      .where(eq(rosterAssignments.playerId, playerId));
    return rows.map(toRosterAssignment);
  },

  /**
   * The Player's assignments within a single Season. Joins
   * `roster_assignments → teams` on `teams.id = roster_assignments.team_id`
   * and filters by `teams.season_id = seasonId`, so the service's
   * one-assignment-per-Player-per-Season guard reads exactly the Player's
   * assignments in the target Season.
   */
  async listByPlayerInSeason(
    playerId: string,
    seasonId: string,
    ex: Executor,
  ): Promise<RosterAssignment[]> {
    const rows = await ex
      .select({ assignment: rosterAssignments })
      .from(rosterAssignments)
      .innerJoin(teams, eq(teams.id, rosterAssignments.teamId))
      .where(
        and(
          eq(rosterAssignments.playerId, playerId),
          eq(teams.seasonId, seasonId),
        ),
      );
    return rows.map((r) => toRosterAssignment(r.assignment));
  },

  async updateJersey(
    assignmentId: string,
    jerseyNumber: number,
    ex: Executor,
  ): Promise<RosterAssignment | null> {
    const [row] = await ex
      .update(rosterAssignments)
      .set({ jerseyNumber })
      .where(eq(rosterAssignments.id, assignmentId))
      .returning();
    return row ? toRosterAssignment(row) : null;
  },

  /** @returns true if a row was removed. */
  async delete(assignmentId: string, ex: Executor): Promise<boolean> {
    const rows = await ex
      .delete(rosterAssignments)
      .where(eq(rosterAssignments.id, assignmentId))
      .returning({ id: rosterAssignments.id });
    return rows.length > 0;
  },
};
