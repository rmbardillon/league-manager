/**
 * Pure, testable mirror of the player master-data migration backfill.
 *
 * The one-time migration (see design.md "Migration Design") reshapes each
 * legacy team-scoped `players` row `{ id, team_id, name, jersey_number }` into
 *   - one **master** `players` row `{ id, name }` that KEEPS the same `id`, and
 *   - one `roster_assignments` row `{ player_id: <legacy id>, team_id,
 *     jersey_number }`.
 *
 * In the generated SQL migration this is expressed as a hand-added
 * `INSERT INTO roster_assignments (...) SELECT ... FROM players` backfill block
 * (task 1.4). That SQL cannot be unit tested without a live database, so the
 * row-level transform is extracted here as a pure function. The embedded SQL
 * mirrors {@link backfillPlayers} exactly: Properties 12–14 test this function
 * directly (losslessness, id-preservation round trip, idempotence) to give
 * DB-free confidence that the migration SQL is correct.
 *
 * Correctness guarantees upheld by this transform:
 *   - **Id preservation**: for every legacy row, `master.id === legacy.id` and
 *     `assignment.playerId === legacy.id`, so every existing `statistics` and
 *     `award_players` reference to that id keeps resolving    (Req 7.2, 5.1, 6.1)
 *   - **Losslessness**: name, team, and jersey are carried over verbatim; one
 *     master player and one assignment are produced per legacy row (Req 7.1, 7.3)
 *   - **Deterministic order**: outputs follow the input order exactly.
 *
 * The function is pure: it performs no I/O and never mutates its input.
 *
 * _Requirements: 7.1, 7.2, 7.3_
 */

/**
 * A legacy, team-scoped `players` row as it exists before the migration. This
 * is the shape the migration reads from.
 */
export interface LegacyPlayerRow {
  /** The legacy player id — preserved as the master player id. */
  id: string;
  /** The Team this legacy player belonged to; moves onto the assignment. */
  teamId: string;
  /** The player's name (1–100 chars); preserved on the master player. */
  name: string;
  /** The jersey number (0–99); moves onto the assignment. */
  jerseyNumber: number;
}

/**
 * The result of the backfill transform: the master players and the roster
 * assignments to create, in the same order as the input rows. Assignment ids
 * are intentionally omitted — the SQL backfill generates them with
 * `gen_random_uuid()`.
 */
export interface BackfillOutput {
  /** One master player per legacy row, with the legacy id preserved. */
  players: { id: string; name: string }[];
  /** One assignment per legacy row, linking the master id to its Team/jersey. */
  assignments: { playerId: string; teamId: string; jerseyNumber: number }[];
}

/**
 * Transform legacy team-scoped player rows into master players plus roster
 * assignments.
 *
 * For each legacy row, exactly one master player `{ id, name }` is produced
 * (with the legacy `id` preserved) and exactly one assignment
 * `{ playerId, teamId, jerseyNumber }` (with `playerId === legacy.id`). Name,
 * team, and jersey are preserved verbatim. The outputs are emitted in the same
 * order as the input rows.
 *
 * Pure: no I/O, no mutation of `rows` or its elements.
 *
 * @param rows The legacy `players` rows to convert.
 * @returns The master players and roster assignments to insert.
 */
export function backfillPlayers(rows: readonly LegacyPlayerRow[]): BackfillOutput {
  const players: { id: string; name: string }[] = [];
  const assignments: { playerId: string; teamId: string; jerseyNumber: number }[] = [];

  for (const row of rows) {
    players.push({ id: row.id, name: row.name });
    assignments.push({
      playerId: row.id,
      teamId: row.teamId,
      jerseyNumber: row.jerseyNumber,
    });
  }

  return { players, assignments };
}
