/**
 * Pure domain logic for Batch_Upload validation (Requirement 11).
 *
 * A Batch_Upload populates Teams and Players for a Season. This module is
 * I/O-free and deterministic so it can be exercised as universal properties
 * (design Properties 26 and 27). It provides the pure {@link validateBatch}
 * function, which classifies each parsed row and produces an all-or-nothing
 * decision plus a per-row report:
 *
 *  - A row is invalid *if and only if* it has a missing required field, a name
 *    whose length falls outside 1–100 characters, a jersey number duplicated
 *    within the same Team, or otherwise malformed data (Req 11.4, Property 27).
 *  - When every row is valid, the batch is accepted and reports a count equal
 *    to the number of rows (Req 11.2). When one or more rows are invalid, the
 *    batch is rejected as a whole and the report names each invalid row (by its
 *    zero-based index) together with the reason(s) it failed (Req 11.3,
 *    Property 26).
 *
 * The function does not parse files and does not persist anything. Callers (the
 * BatchUploadService) parse the CSV/.xlsx into {@link BatchRow} values, reject
 * unsupported formats and empty files, and — only when this function accepts —
 * import all rows inside a single all-or-nothing transaction.
 *
 * _Requirements: 11.2, 11.3, 11.4_
 */

// ---------------------------------------------------------------------------
// Bounds (mirror the Player/Team data-model constraints in types.ts).
// ---------------------------------------------------------------------------

/** Minimum permitted name length, in characters (inclusive) (Req 11.4). */
export const NAME_LENGTH_MIN = 1;

/** Maximum permitted name length, in characters (inclusive) (Req 11.4). */
export const NAME_LENGTH_MAX = 100;

/** Minimum permitted jersey number (inclusive). */
export const JERSEY_NUMBER_MIN = 0;

/** Maximum permitted jersey number (inclusive). */
export const JERSEY_NUMBER_MAX = 99;

// ---------------------------------------------------------------------------
// Row shape and reason taxonomy
// ---------------------------------------------------------------------------

/**
 * A single parsed row of a Batch_Upload describing a Player to add to a Team.
 *
 * Fields are typed as `unknown`/optional so that malformed parser output (a
 * missing column, a non-string name, a non-numeric jersey, etc.) is expressible
 * and can be classified as invalid rather than being assumed well-formed.
 */
export interface BatchRow {
  /** Name of the Team the Player belongs to. Required, 1–100 chars. */
  teamName?: unknown;
  /** Name of the Player. Required, 1–100 chars. */
  playerName?: unknown;
  /** Jersey number within the Team roster. Required integer, 0–99. */
  jerseyNumber?: unknown;
}

/**
 * A reason a row was classified invalid. A single row may fail for more than
 * one reason (e.g. a missing field and a duplicate jersey), so the report
 * carries a list of reasons per row.
 */
export type RowInvalidReason =
  | 'missing_team_name'
  | 'missing_player_name'
  | 'missing_jersey_number'
  | 'team_name_length_out_of_range'
  | 'player_name_length_out_of_range'
  | 'malformed_jersey_number'
  | 'jersey_number_out_of_range'
  | 'duplicate_jersey_in_team';

/** Report entry naming a single invalid row and every reason it failed. */
export interface InvalidRowReport {
  /** Zero-based index of the offending row within the submitted batch. */
  index: number;
  /** Every reason this row was classified invalid, in check order. */
  reasons: RowInvalidReason[];
}

/**
 * All-or-nothing outcome of validating a batch.
 *
 *  - `accepted: true`  → every row is valid; `importedCount` equals the number
 *    of rows the caller should import (Req 11.2).
 *  - `accepted: false` → one or more rows are invalid; `invalidRows` names each
 *    invalid row and its reason(s); the caller imports nothing (Req 11.3).
 */
export type BatchValidationResult =
  | { accepted: true; importedCount: number }
  | { accepted: false; invalidRows: InvalidRowReport[] };

// ---------------------------------------------------------------------------
// Field predicates
// ---------------------------------------------------------------------------

/** True when `value` is a present, non-empty string (a supplied text field). */
function isPresentString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}

/** True when the string length is within the inclusive 1–100 range (Req 11.4). */
function isValidNameLength(name: string): boolean {
  return name.length >= NAME_LENGTH_MIN && name.length <= NAME_LENGTH_MAX;
}

/** True when `value` is a non-negative integer within the inclusive 0–99 range. */
function isValidJerseyNumber(value: number): boolean {
  return (
    Number.isInteger(value) &&
    value >= JERSEY_NUMBER_MIN &&
    value <= JERSEY_NUMBER_MAX
  );
}

// ---------------------------------------------------------------------------
// Per-row classification (Req 11.4, Property 27)
// ---------------------------------------------------------------------------

/**
 * Returns the list of reasons a single row is invalid, considered in isolation
 * from other rows (i.e. every reason except cross-row jersey duplication). An
 * empty list means the row is well-formed on its own.
 *
 * A field is "missing" when it is absent, `null`/`undefined`, or an empty
 * string. A name present but of the wrong length, or a jersey that is not a
 * 0–99 integer, is malformed data (Req 11.4).
 */
function classifyRowFields(row: BatchRow): RowInvalidReason[] {
  const reasons: RowInvalidReason[] = [];

  // --- Team name: required, 1–100 chars.
  if (!isPresentString(row.teamName)) {
    reasons.push('missing_team_name');
  } else if (!isValidNameLength(row.teamName)) {
    reasons.push('team_name_length_out_of_range');
  }

  // --- Player name: required, 1–100 chars.
  if (!isPresentString(row.playerName)) {
    reasons.push('missing_player_name');
  } else if (!isValidNameLength(row.playerName)) {
    reasons.push('player_name_length_out_of_range');
  }

  // --- Jersey number: required, well-formed integer, 0–99.
  const jersey = row.jerseyNumber;
  if (jersey === undefined || jersey === null || jersey === '') {
    reasons.push('missing_jersey_number');
  } else if (typeof jersey !== 'number' || Number.isNaN(jersey)) {
    reasons.push('malformed_jersey_number');
  } else if (!isValidJerseyNumber(jersey)) {
    reasons.push('jersey_number_out_of_range');
  }

  return reasons;
}

/**
 * The Team-scoped identity of a row's Team, used to detect jersey duplication
 * "within the same Team". Team names are compared case-insensitively, matching
 * the case-insensitive Team-name uniqueness of the data model.
 */
function teamKey(teamName: string): string {
  return teamName.trim().toLowerCase();
}

// ---------------------------------------------------------------------------
// Batch validation (Req 11.2, 11.3, Property 26)
// ---------------------------------------------------------------------------

/**
 * Validates a batch of parsed upload rows and returns an all-or-nothing
 * decision with a per-row report.
 *
 * Classification (Property 27, Req 11.4): a row is invalid *if and only if* it
 * has a missing required field, a name length outside 1–100, a jersey number
 * duplicated within the same Team, or otherwise malformed data.
 *
 * Duplicate-jersey detection is scoped to a Team: two rows collide only when
 * they name the same Team (case-insensitively) and carry the same valid jersey
 * number. Rows whose Team name or jersey number is itself missing/malformed do
 * not participate in duplicate detection (they are already invalid for that
 * reason), so the same jersey number is allowed across different Teams.
 *
 * Decision (Property 26, Req 11.2, 11.3): when no row is invalid the batch is
 * accepted with `importedCount === rows.length`; otherwise it is rejected and
 * `invalidRows` names each invalid row (zero-based index) and its reason(s).
 * The caller imports all rows on acceptance and nothing on rejection.
 */
export function validateBatch(
  rows: readonly BatchRow[],
): BatchValidationResult {
  // First pass: classify each row's own fields.
  const reasonsByIndex: RowInvalidReason[][] = rows.map((row) =>
    classifyRowFields(row),
  );

  // Second pass: group rows that have a valid Team name AND a valid jersey
  // number by (team, jersey) so we can flag every member of any colliding
  // group. Only rows well-formed on both fields are eligible to collide.
  const indicesByTeamJersey = new Map<string, number[]>();
  // A row participates in duplicate detection whenever its own Team name and
  // jersey number are both well-formed — even if the row is invalid for an
  // unrelated reason (e.g. a bad Player name) — so a genuine same-Team jersey
  // collision is still reported.
  rows.forEach((row, index) => {
    const hasValidTeam =
      isPresentString(row.teamName) && isValidNameLength(row.teamName);
    const jersey = row.jerseyNumber;
    const hasValidJersey =
      typeof jersey === 'number' &&
      !Number.isNaN(jersey) &&
      isValidJerseyNumber(jersey);
    if (!hasValidTeam || !hasValidJersey) {
      return;
    }
    const key = `${teamKey(row.teamName as string)}#${jersey}`;
    const bucket = indicesByTeamJersey.get(key);
    if (bucket) {
      bucket.push(index);
    } else {
      indicesByTeamJersey.set(key, [index]);
    }
  });

  for (const indices of indicesByTeamJersey.values()) {
    if (indices.length > 1) {
      for (const index of indices) {
        reasonsByIndex[index]!.push('duplicate_jersey_in_team');
      }
    }
  }

  // Assemble the report from every row that accumulated at least one reason.
  const invalidRows: InvalidRowReport[] = [];
  reasonsByIndex.forEach((reasons, index) => {
    if (reasons.length > 0) {
      invalidRows.push({ index, reasons });
    }
  });

  if (invalidRows.length > 0) {
    return { accepted: false, invalidRows };
  }
  return { accepted: true, importedCount: rows.length };
}
