/**
 * BatchUploadService — populate a Season's Teams and Players from a file
 * (Requirement 11).
 *
 * A Batch_Upload lets an Administrator create multiple Teams and Players in a
 * single all-or-nothing transaction (Req 11.1). This application service owns
 * the I/O and orchestration around the pure {@link validateBatch} domain
 * function (src/domain/batch.ts):
 *
 *   1. Authorize the caller as an Administrator (Req 11.1). A Batch_Upload is a
 *      Season-scoped, Administrator-only operation, so a non-Administrator is
 *      rejected before anything is parsed or written.
 *   2. Detect the file format from its filename extension and/or MIME type and
 *      accept only CSV and Excel (.xlsx). Any other format is rejected as a
 *      whole and imports nothing (Req 11.5).
 *   3. Parse the file into {@link BatchRow} values. A file that contains no
 *      data rows is rejected as empty and imports nothing (Req 11.6).
 *   4. Run the pure {@link validateBatch}. When any row is invalid the entire
 *      upload is rejected, nothing is imported, and the per-row report is
 *      surfaced in the error `details` (Req 11.3).
 *   5. When every row is valid, import all distinct Teams and their Players
 *      inside one {@link withTransaction} unit so the write is atomic, then
 *      return a confirmation reporting the number of records imported
 *      (Req 11.2).
 *
 * Every failure is expressed as a {@link BatchValidationError} so the API layer
 * maps it to a single consistent status and the whole upload rolls back / never
 * starts. The service holds no HTTP concerns and performs no data access of its
 * own beyond the repositories.
 *
 * _Requirements: 11.1, 11.2, 11.3, 11.5, 11.6_
 */

import { parse as parseCsvSync } from 'csv-parse/sync';
import * as XLSX from 'xlsx';

import { validateBatch, type BatchRow } from '../domain/batch.js';
import { authorize, type AuthUser } from '../domain/authorize.js';
import { AuthorizationError, BatchValidationError } from '../domain/errors.js';
import { withTransaction } from '../repositories/executor.js';
import type { Database } from '../repositories/executor.js';
import {
  playerRepository,
  rosterAssignmentRepository,
  teamRepository,
} from '../repositories/index.js';

// ---------------------------------------------------------------------------
// Input + result shapes
// ---------------------------------------------------------------------------

/**
 * An uploaded file to import. Carries the raw bytes together with the metadata
 * used to detect the format: the original `filename` (its extension) and/or the
 * `mimeType` reported by the transport.
 */
export interface UploadedFile {
  /** Raw file bytes. */
  readonly buffer: Buffer;
  /** Original filename, used to read the extension (e.g. `roster.csv`). */
  readonly filename?: string;
  /** MIME type reported by the transport, if any. */
  readonly mimeType?: string;
}

/** Command to import Teams and Players into a Season from a file (Req 11.1). */
export interface UploadTeamsAndPlayersCommand {
  /** The Season the imported Teams belong to. */
  readonly seasonId: string;
  /** The uploaded CSV/.xlsx file. */
  readonly file: UploadedFile;
}

/**
 * Confirmation returned by a successful import (Req 11.2). Reports the number
 * of records imported, broken down into Teams and Players; `importedRecords` is
 * their sum.
 */
export interface BatchUploadResult {
  /** Distinct Teams created by the import. */
  readonly teamsCreated: number;
  /** Players created by the import. */
  readonly playersCreated: number;
  /** Total records imported (`teamsCreated + playersCreated`). */
  readonly importedRecords: number;
}

// ---------------------------------------------------------------------------
// Supported formats (Req 11.1, 11.5)
// ---------------------------------------------------------------------------

/** The file formats a Batch_Upload accepts. */
type BatchFileFormat = 'csv' | 'xlsx';

/** MIME types recognised as CSV. */
const CSV_MIME_TYPES = new Set([
  'text/csv',
  'application/csv',
  'text/plain',
]);

/** MIME types recognised as Excel (.xlsx). */
const XLSX_MIME_TYPES = new Set([
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.ms-excel',
]);

/**
 * Detect the upload format from the filename extension and/or MIME type,
 * accepting only CSV and Excel (.xlsx). Any other (or missing/ambiguous) format
 * is rejected as unsupported (Req 11.5).
 *
 * The filename extension is authoritative when present; the MIME type is used
 * as a fallback when there is no usable extension.
 */
function detectFormat(file: UploadedFile): BatchFileFormat {
  const name = (file.filename ?? '').trim().toLowerCase();
  const dot = name.lastIndexOf('.');
  const ext = dot >= 0 ? name.slice(dot + 1) : '';

  if (ext === 'csv') return 'csv';
  if (ext === 'xlsx') return 'xlsx';
  if (ext.length > 0) {
    // A recognisable but unsupported extension (.xls, .json, .txt, ...).
    throw new BatchValidationError(
      'Unsupported file format. Only CSV and Excel (.xlsx) files are accepted.',
      { field: 'file', extension: ext },
    );
  }

  // No usable extension — fall back to the reported MIME type.
  const mime = (file.mimeType ?? '').trim().toLowerCase();
  if (XLSX_MIME_TYPES.has(mime)) return 'xlsx';
  if (CSV_MIME_TYPES.has(mime)) return 'csv';

  throw new BatchValidationError(
    'Unsupported file format. Only CSV and Excel (.xlsx) files are accepted.',
    { field: 'file', mimeType: file.mimeType ?? null },
  );
}

// ---------------------------------------------------------------------------
// Column-name normalisation and row projection
// ---------------------------------------------------------------------------

/**
 * Header aliases accepted for each {@link BatchRow} field. Headers are compared
 * after lower-casing and stripping non-alphanumeric characters, so
 * `Team Name`, `team_name`, and `teamName` all map to `teamName`.
 */
const HEADER_ALIASES: Record<keyof BatchRow, readonly string[]> = {
  teamName: ['teamname', 'team'],
  playerName: ['playername', 'player', 'name'],
  jerseyNumber: ['jerseynumber', 'jersey', 'jerseyno', 'number', 'no'],
};

/** Canonicalise a header cell for alias matching. */
function canonicalHeader(header: string): string {
  return header.toLowerCase().replace(/[^a-z0-9]/g, '');
}

/** Map a raw header row to the {@link BatchRow} field each column feeds, if any. */
function mapHeaders(headers: readonly string[]): (keyof BatchRow | null)[] {
  return headers.map((raw) => {
    const key = canonicalHeader(raw);
    for (const field of Object.keys(HEADER_ALIASES) as (keyof BatchRow)[]) {
      if (HEADER_ALIASES[field].includes(key)) {
        return field;
      }
    }
    return null;
  });
}

/**
 * Coerce a raw cell into the value {@link validateBatch} expects for a field.
 *
 * Names are kept as trimmed strings (an empty string signals a missing field).
 * The jersey number is converted to a `number` when the cell is a clean integer
 * literal, and otherwise passed through unchanged so `validateBatch` classifies
 * it as malformed rather than this parser silently discarding it.
 */
function coerceCell(field: keyof BatchRow, raw: unknown): unknown {
  if (raw === undefined || raw === null) return undefined;

  if (field === 'jerseyNumber') {
    if (typeof raw === 'number') return raw;
    const text = String(raw).trim();
    if (text === '') return undefined;
    // Accept only a plain (optionally signed) integer literal; anything else
    // (e.g. "12a", "1.5") stays a string so validateBatch flags it malformed.
    if (/^[+-]?\d+$/.test(text)) return Number(text);
    return text;
  }

  const text = String(raw).trim();
  return text.length === 0 ? undefined : text;
}

/** Build a {@link BatchRow} from a positional data row and its header mapping. */
function projectRow(
  cells: readonly unknown[],
  headerFields: readonly (keyof BatchRow | null)[],
): BatchRow {
  const row: BatchRow = {};
  headerFields.forEach((field, column) => {
    if (field === null) return;
    row[field] = coerceCell(field, cells[column]);
  });
  return row;
}

/** True when a positional row is entirely empty (all cells blank). */
function isBlankRow(cells: readonly unknown[]): boolean {
  return cells.every(
    (cell) =>
      cell === undefined ||
      cell === null ||
      (typeof cell === 'string' && cell.trim() === ''),
  );
}

// ---------------------------------------------------------------------------
// Parsers (Req 11.5, 11.6)
// ---------------------------------------------------------------------------

/**
 * Parse a matrix of cells (header row + data rows) into {@link BatchRow}s.
 * Fully blank rows are dropped so trailing newlines do not count as data.
 * Rejects the upload as empty when there is no header or no data row (Req 11.6).
 */
function rowsFromMatrix(matrix: unknown[][]): BatchRow[] {
  const nonEmpty = matrix.filter((cells) => !isBlankRow(cells));
  if (nonEmpty.length < 2) {
    // Fewer than two non-blank rows means a header with no data (or nothing).
    throw new BatchValidationError(
      'The uploaded file contains no data rows.',
      { field: 'file' },
    );
  }

  const [headerCells, ...dataRows] = nonEmpty;
  const headerFields = mapHeaders(headerCells!.map((c) => String(c ?? '')));
  return dataRows.map((cells) => projectRow(cells, headerFields));
}

/** Parse CSV bytes into {@link BatchRow}s (Req 11.5, 11.6). */
function parseCsv(buffer: Buffer): BatchRow[] {
  let matrix: unknown[][];
  try {
    matrix = parseCsvSync(buffer, {
      // Keep the raw matrix so header aliasing is done uniformly with .xlsx.
      columns: false,
      skip_empty_lines: true,
      trim: true,
      relax_column_count: true,
    }) as unknown[][];
  } catch {
    throw new BatchValidationError('The uploaded CSV file could not be parsed.', {
      field: 'file',
    });
  }
  return rowsFromMatrix(matrix);
}

/** Parse Excel (.xlsx) bytes into {@link BatchRow}s (Req 11.5, 11.6). */
function parseXlsx(buffer: Buffer): BatchRow[] {
  let workbook: XLSX.WorkBook;
  try {
    workbook = XLSX.read(buffer, { type: 'buffer' });
  } catch {
    throw new BatchValidationError(
      'The uploaded Excel file could not be parsed.',
      { field: 'file' },
    );
  }

  const firstSheetName = workbook.SheetNames[0];
  if (firstSheetName === undefined) {
    throw new BatchValidationError('The uploaded file contains no data rows.', {
      field: 'file',
    });
  }
  const sheet = workbook.Sheets[firstSheetName]!;
  const matrix = XLSX.utils.sheet_to_json<unknown[]>(sheet, {
    header: 1,
    blankrows: false,
    defval: undefined,
    raw: true,
  });
  return rowsFromMatrix(matrix);
}

/** Dispatch to the parser for the detected format. */
function parseRows(file: UploadedFile, format: BatchFileFormat): BatchRow[] {
  return format === 'csv' ? parseCsv(file.buffer) : parseXlsx(file.buffer);
}

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

/**
 * Application service for Batch_Upload. Construct it with a {@link Database}
 * handle; the import runs inside a single transaction so it is all-or-nothing.
 */
export class BatchUploadService {
  constructor(private readonly db: Database) {}

  /**
   * Import Teams and Players into a Season from an uploaded file (Req 11.1).
   *
   * Order of operations: Administrator authorization (Req 11.1) → format
   * detection accepting only CSV/.xlsx (Req 11.5) → parse and reject an empty
   * file (Req 11.6) → pure {@link validateBatch} (Req 11.3) → single
   * all-or-nothing import returning the record count (Req 11.2). On any failure
   * nothing is imported: a rejection either throws before the transaction or
   * never begins one.
   */
  async uploadTeamsAndPlayers(
    user: AuthUser,
    command: UploadTeamsAndPlayersCommand,
  ): Promise<BatchUploadResult> {
    // Req 11.1: a Batch_Upload is an Administrator-only, Season-scoped action.
    const decision = authorize(user, 'create', { kind: 'admin' });
    if (!decision.allowed) {
      throw new AuthorizationError(decision.reason);
    }

    // Req 11.5 / 11.6: accept only CSV/.xlsx and reject an empty file. Both are
    // detected before any write occurs, so nothing is imported on rejection.
    const format = detectFormat(command.file);
    const rows = parseRows(command.file, format);

    // Req 11.3: all-or-nothing validation. Any invalid row rejects the whole
    // upload and imports nothing; the per-row report is carried in `details`.
    const result = validateBatch(rows);
    if (!result.accepted) {
      throw new BatchValidationError(
        'The uploaded file contains one or more invalid rows; no records were imported.',
        { invalidRows: result.invalidRows },
      );
    }

    // Req 11.2: every row is valid — import all Teams and Players atomically and
    // report the number of records imported.
    return this.importRows(command.seasonId, rows);
  }

  /**
   * Import validated rows inside one transaction (Req 8.1, 8.2, 8.3).
   *
   * Teams are deduplicated by case-insensitive name so each distinct Team named
   * across the rows is created exactly once. Then, under the master-Player
   * model, **every row produces a new master Player** `{ name }` — an existing
   * master is never reused (Req 8.3) — paired with a Roster_Assignment linking
   * that new master to the row's Team with the row's jersey number. The whole
   * write is a single {@link withTransaction} unit, so any failure (e.g. a
   * database constraint) rolls the entire import back and leaves the Season
   * unchanged (all-or-nothing — Req 8.1/8.2).
   *
   * `playersCreated` counts one master Player per row, and the number of
   * assignments created equals the number of rows.
   */
  private async importRows(
    seasonId: string,
    rows: readonly BatchRow[],
  ): Promise<BatchUploadResult> {
    return withTransaction(this.db, async (tx) => {
      // Deduplicate Teams by case-insensitive name, preserving first-seen order
      // and the original (untrimmed-but-coerced) display name.
      const teamNameByKey = new Map<string, string>();
      for (const row of rows) {
        const name = row.teamName as string;
        const key = name.trim().toLowerCase();
        if (!teamNameByKey.has(key)) {
          teamNameByKey.set(key, name);
        }
      }

      // Create each distinct Team once and remember its id per case-insensitive
      // key so assignments can be attached.
      const teamIdByKey = new Map<string, string>();
      const teamInputs = [...teamNameByKey.entries()].map(([, name]) => ({
        seasonId,
        name,
      }));
      const createdTeams = await teamRepository.createMany(teamInputs, tx);
      createdTeams.forEach((team) => {
        teamIdByKey.set(team.name.trim().toLowerCase(), team.id);
      });

      // Create one new master Player per row (never reusing an existing master,
      // Req 8.3), preserving row order so each created master pairs back to its
      // row's Team and jersey.
      const playerInputs = rows.map((row) => ({
        name: row.playerName as string,
      }));
      const createdPlayers = await playerRepository.createMany(playerInputs, tx);

      // Pair each created master (by row order) with its row's Team and jersey,
      // then create the roster assignments in the same transaction.
      const assignmentInputs = rows.map((row, index) => {
        const key = (row.teamName as string).trim().toLowerCase();
        return {
          playerId: createdPlayers[index]!.id,
          teamId: teamIdByKey.get(key)!,
          jerseyNumber: row.jerseyNumber as number,
        };
      });
      await rosterAssignmentRepository.createMany(assignmentInputs, tx);

      return {
        teamsCreated: createdTeams.length,
        playersCreated: createdPlayers.length,
        importedRecords: createdTeams.length + createdPlayers.length,
      };
    });
  }
}

/**
 * Convenience factory mirroring the other services: build a
 * {@link BatchUploadService} bound to a {@link Database} handle.
 */
export function createBatchUploadService(db: Database): BatchUploadService {
  return new BatchUploadService(db);
}
