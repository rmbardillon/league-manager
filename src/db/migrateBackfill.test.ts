import { describe, it, expect } from 'vitest';
import fc from 'fast-check';

import { backfillPlayers, type LegacyPlayerRow } from './migrateBackfill.js';

/**
 * Property tests for the pure `backfillPlayers` migration transform.
 *
 * The one-time migration reshapes each legacy team-scoped `players` row into a
 * master `players` row (id preserved) plus a `roster_assignments` row. These
 * properties give DB-free confidence that the hand-edited migration SQL — which
 * mirrors {@link backfillPlayers} — is lossless, identity-preserving, and
 * idempotent.
 *
 * Minimum 100 runs per property (`fast-check`).
 */

/** A single legacy row arbitrary matching the migration input shape. */
const legacyRow = (): fc.Arbitrary<LegacyPlayerRow> =>
  fc.record({
    id: fc.uuid(),
    teamId: fc.uuid(),
    name: fc.string({ minLength: 1, maxLength: 100 }),
    jerseyNumber: fc.integer({ min: 0, max: 99 }),
  });

/** A list of legacy rows (the full migration input). */
const legacyRows = (): fc.Arbitrary<LegacyPlayerRow[]> => fc.array(legacyRow());

describe('backfillPlayers migration transform', () => {
  // Feature: player-master-data, Property 12: Migration losslessness and post-conditions
  // Validates: Requirements 7.1, 7.3, 7.4, 9.4
  it('produces exactly one master player and one assignment per row, preserving name/teamId/jerseyNumber in input order', () => {
    fc.assert(
      fc.property(legacyRows(), (rows) => {
        const { players, assignments } = backfillPlayers(rows);

        // One master player and one assignment per legacy row.
        expect(players.length).toBe(rows.length);
        expect(assignments.length).toBe(rows.length);

        // The i-th outputs correspond to the i-th input row, preserving fields.
        for (let i = 0; i < rows.length; i++) {
          const row = rows[i];
          const player = players[i];
          const assignment = assignments[i];

          // Master player preserves the name (and carries no team/jersey).
          expect(player.name).toBe(row.name);

          // Assignment preserves the team and jersey verbatim.
          expect(assignment.teamId).toBe(row.teamId);
          expect(assignment.jerseyNumber).toBe(row.jerseyNumber);
        }
      }),
      { numRuns: 100 },
    );
  });

  // Feature: player-master-data, Property 13: Migration id-preservation round trip
  // Validates: Requirements 5.1, 6.1, 7.2
  it('preserves each legacy id as both the master player id and the assignment playerId', () => {
    fc.assert(
      fc.property(legacyRows(), (rows) => {
        const { players, assignments } = backfillPlayers(rows);

        for (let i = 0; i < rows.length; i++) {
          const legacyId = rows[i].id;
          // Identity is preserved so existing statistics/award references resolve.
          expect(players[i].id).toBe(legacyId);
          expect(assignments[i].playerId).toBe(legacyId);
        }
      }),
      { numRuns: 100 },
    );
  });

  // Feature: player-master-data, Property 14: Migration idempotence
  // Validates: Requirements 7.5
  it('is deterministic (applying twice equals once) and a guarded second pass over already-assigned ids produces no new assignments', () => {
    fc.assert(
      fc.property(legacyRows(), (rows) => {
        // Pure/deterministic: the same input yields identical output every time.
        const first = backfillPlayers(rows);
        const second = backfillPlayers(rows);
        expect(second).toEqual(first);

        // Model the SQL `WHERE NOT EXISTS` guard: after the first pass, every
        // row's id already has an assignment. A guarded second pass filters out
        // rows whose id already exists in the assignment set, so it must create
        // zero new assignments and zero new master players.
        const existingPlayerIds = new Set(first.assignments.map((a) => a.playerId));
        const remainingRows = rows.filter((row) => !existingPlayerIds.has(row.id));
        const guardedSecondPass = backfillPlayers(remainingRows);

        expect(guardedSecondPass.players).toHaveLength(0);
        expect(guardedSecondPass.assignments).toHaveLength(0);
      }),
      { numRuns: 100 },
    );
  });
});
