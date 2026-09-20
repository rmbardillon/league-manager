/**
 * User and Session repositories (data access only).
 *
 * A {@link User} is an aggregate spanning `users`, `user_managed_teams`, and
 * `user_failed_attempts`. Reads join the three; writes that touch more than
 * one table (e.g. creating a User together with its managed-team links) are
 * multi-write operations and should be run inside `withTransaction` so they
 * are all-or-nothing (Req 6.1-style atomicity).
 *
 * No validation beyond database constraints; no business logic.
 *
 * _Requirements: 3.7, 6.1, 11.3_
 */
import { eq } from 'drizzle-orm';
import {
  sessions,
  userFailedAttempts,
  userManagedTeams,
  users,
  type NewSessionRow,
  type NewUserRow,
} from '../db/schema.js';
import type { Session, User } from '../domain/types.js';
import type { Executor } from './executor.js';
import { toSession, toUser } from './mappers.js';

/** Load the managed-team ids and failed-attempt timestamps for a User. */
async function loadUserAggregates(
  userId: string,
  ex: Executor,
): Promise<{ managedTeamIds: string[]; failedAttempts: { at: Date }[] }> {
  const managed = await ex
    .select({ teamId: userManagedTeams.teamId })
    .from(userManagedTeams)
    .where(eq(userManagedTeams.userId, userId));
  const attempts = await ex
    .select({ at: userFailedAttempts.attemptedAt })
    .from(userFailedAttempts)
    .where(eq(userFailedAttempts.userId, userId));
  return {
    managedTeamIds: managed.map((m) => m.teamId),
    failedAttempts: attempts.map((a) => ({ at: a.at })),
  };
}

export const userRepository = {
  /**
   * Create a User and, atomically, its managed-team links. Run inside
   * `withTransaction` to keep the base row and links all-or-nothing.
   */
  async create(input: NewUserRow, managedTeamIds: string[], ex: Executor): Promise<User> {
    const [row] = await ex.insert(users).values(input).returning();
    const created = row!;
    if (managedTeamIds.length > 0) {
      await ex
        .insert(userManagedTeams)
        .values(managedTeamIds.map((teamId) => ({ userId: created.id, teamId })));
    }
    return toUser(created, managedTeamIds, []);
  },

  async findById(id: string, ex: Executor): Promise<User | null> {
    const [row] = await ex.select().from(users).where(eq(users.id, id)).limit(1);
    if (!row) return null;
    const { managedTeamIds, failedAttempts } = await loadUserAggregates(row.id, ex);
    return toUser(row, managedTeamIds, failedAttempts);
  },

  async findByUsername(username: string, ex: Executor): Promise<User | null> {
    const [row] = await ex.select().from(users).where(eq(users.username, username)).limit(1);
    if (!row) return null;
    const { managedTeamIds, failedAttempts } = await loadUserAggregates(row.id, ex);
    return toUser(row, managedTeamIds, failedAttempts);
  },

  async update(id: string, patch: Partial<NewUserRow>, ex: Executor): Promise<User | null> {
    const [row] = await ex.update(users).set(patch).where(eq(users.id, id)).returning();
    if (!row) return null;
    const { managedTeamIds, failedAttempts } = await loadUserAggregates(row.id, ex);
    return toUser(row, managedTeamIds, failedAttempts);
  },

  /** Replace the set of Teams managed by a User (atomic delete + insert). */
  async setManagedTeams(userId: string, teamIds: string[], ex: Executor): Promise<void> {
    await ex.delete(userManagedTeams).where(eq(userManagedTeams.userId, userId));
    if (teamIds.length > 0) {
      await ex.insert(userManagedTeams).values(teamIds.map((teamId) => ({ userId, teamId })));
    }
  },

  /** Record a failed sign-in attempt backing the rolling-window lockout. */
  async recordFailedAttempt(userId: string, at: Date, ex: Executor): Promise<void> {
    await ex.insert(userFailedAttempts).values({ userId, attemptedAt: at });
  },

  /** Clear all recorded failed attempts for a User (e.g. after a success). */
  async clearFailedAttempts(userId: string, ex: Executor): Promise<void> {
    await ex.delete(userFailedAttempts).where(eq(userFailedAttempts.userId, userId));
  },

  /** @returns true if a row was removed. */
  async delete(id: string, ex: Executor): Promise<boolean> {
    const rows = await ex.delete(users).where(eq(users.id, id)).returning({ id: users.id });
    return rows.length > 0;
  },
};

export const sessionRepository = {
  async create(input: NewSessionRow, ex: Executor): Promise<Session> {
    const [row] = await ex.insert(sessions).values(input).returning();
    return toSession(row!);
  },

  async findById(id: string, ex: Executor): Promise<Session | null> {
    const [row] = await ex.select().from(sessions).where(eq(sessions.id, id)).limit(1);
    return row ? toSession(row) : null;
  },

  /** Slide the inactivity window by updating `lastActivityAt` (Req 1.2). */
  async touch(id: string, lastActivityAt: Date, ex: Executor): Promise<Session | null> {
    const [row] = await ex
      .update(sessions)
      .set({ lastActivityAt })
      .where(eq(sessions.id, id))
      .returning();
    return row ? toSession(row) : null;
  },

  /** Terminate a session (sign-out). @returns true if a row was removed. */
  async delete(id: string, ex: Executor): Promise<boolean> {
    const rows = await ex.delete(sessions).where(eq(sessions.id, id)).returning({ id: sessions.id });
    return rows.length > 0;
  },
};
