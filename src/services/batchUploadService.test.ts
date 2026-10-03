import { describe, it, expect, vi } from 'vitest';
import fc from 'fast-check';
import * as XLSX from 'xlsx';

import {
  BatchUploadService,
  type UploadedFile,
} from './batchUploadService.js';
import { AuthorizationError, BatchValidationError } from '../domain/errors.js';
import type { AuthUser } from '../domain/authorize.js';
import type { Database, Transaction } from '../repositories/executor.js';
import {
  playerRepository,
  rosterAssignmentRepository,
  teamRepository,
} from '../repositories/index.js';

/**
 * BatchUploadService unit tests.
 *
 * These exercise the service without a real database: `db.transaction` is
 * stubbed to invoke the callback with a marker transaction, and the Team,
 * master Player, and Roster_Assignment repositories are spied so we can assert
 * what would be written. Under the master-Player model a valid upload creates,
 * in one transaction: each distinct Team once, one NEW master Player `{ name }`
 * per row, and one Roster_Assignment `{ playerId, teamId, jerseyNumber }` per
 * row pairing that new master back to its row's Team and jersey. They verify:
 *   - Administrator-only authorization (Req 11.1)
 *   - CSV and .xlsx are accepted; other formats are rejected (Req 11.1, 11.5)
 *   - an empty file (no data rows) is rejected (Req 11.6)
 *   - any invalid row rejects the whole upload with a per-row report (Req 11.3)
 *   - a valid upload imports distinct Teams once + a master Player and an
 *     assignment per row, and reports the record count (Req 8.1, 8.2, 11.2)
 */

const admin: AuthUser = { id: 'admin-1', role: 'Administrator', managedTeamIds: [] };
const viewer: AuthUser = { id: 'v-1', role: 'Viewer', managedTeamIds: [] };

/** A Database whose transaction runs the callback with a marker tx. */
function stubDb(): Database {
  const tx = { marker: 'tx' } as unknown as Transaction;
  const transaction = vi.fn(async (work: (t: Transaction) => Promise<unknown>) =>
    work(tx),
  );
  return { transaction } as unknown as Database;
}

/** Build a CSV UploadedFile from raw text. */
function csvFile(text: string, filename = 'roster.csv'): UploadedFile {
  return { buffer: Buffer.from(text, 'utf8'), filename };
}

/** Build an .xlsx UploadedFile from a matrix (header row + data rows). */
function xlsxFile(matrix: unknown[][], filename = 'roster.xlsx'): UploadedFile {
  const sheet = XLSX.utils.aoa_to_sheet(matrix);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, sheet, 'Sheet1');
  const buffer = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer;
  return { buffer, filename };
}

const VALID_CSV = [
  'teamName,playerName,jerseyNumber',
  'Warriors,Alice,10',
  'Warriors,Bob,11',
  'Lakers,Carol,7',
].join('\n');

describe('BatchUploadService.uploadTeamsAndPlayers', () => {
  it('rejects a non-Administrator before parsing (Req 11.1)', async () => {
    const svc = new BatchUploadService(stubDb());
    const createTeams = vi.spyOn(teamRepository, 'createMany');
    const createAssignments = vi.spyOn(rosterAssignmentRepository, 'createMany');

    await expect(
      svc.uploadTeamsAndPlayers(viewer, {
        seasonId: 's-1',
        file: csvFile(VALID_CSV),
      }),
    ).rejects.toBeInstanceOf(AuthorizationError);
    expect(createTeams).not.toHaveBeenCalled();
    expect(createAssignments).not.toHaveBeenCalled();
    createTeams.mockRestore();
    createAssignments.mockRestore();
  });

  it('rejects an unsupported file format and imports nothing (Req 11.5)', async () => {
    const svc = new BatchUploadService(stubDb());
    const createTeams = vi.spyOn(teamRepository, 'createMany');
    const createAssignments = vi.spyOn(rosterAssignmentRepository, 'createMany');

    await expect(
      svc.uploadTeamsAndPlayers(admin, {
        seasonId: 's-1',
        file: { buffer: Buffer.from('{}'), filename: 'roster.json' },
      }),
    ).rejects.toBeInstanceOf(BatchValidationError);
    expect(createTeams).not.toHaveBeenCalled();
    expect(createAssignments).not.toHaveBeenCalled();
    createTeams.mockRestore();
    createAssignments.mockRestore();
  });

  it('rejects a file with no data rows as empty (Req 11.6)', async () => {
    const svc = new BatchUploadService(stubDb());
    const createTeams = vi.spyOn(teamRepository, 'createMany');
    const createAssignments = vi.spyOn(rosterAssignmentRepository, 'createMany');

    await expect(
      svc.uploadTeamsAndPlayers(admin, {
        seasonId: 's-1',
        file: csvFile('teamName,playerName,jerseyNumber\n'),
      }),
    ).rejects.toBeInstanceOf(BatchValidationError);
    expect(createTeams).not.toHaveBeenCalled();
    expect(createAssignments).not.toHaveBeenCalled();
    createTeams.mockRestore();
    createAssignments.mockRestore();
  });

  it('rejects the whole upload with a per-row report when a row is invalid (Req 11.3)', async () => {
    const svc = new BatchUploadService(stubDb());
    const createTeams = vi.spyOn(teamRepository, 'createMany');
    const createAssignments = vi.spyOn(rosterAssignmentRepository, 'createMany');
    // Row index 1 has an out-of-range jersey number (150).
    const csv = [
      'teamName,playerName,jerseyNumber',
      'Warriors,Alice,10',
      'Warriors,Bob,150',
    ].join('\n');

    await expect(
      svc.uploadTeamsAndPlayers(admin, { seasonId: 's-1', file: csvFile(csv) }),
    ).rejects.toMatchObject({
      constructor: BatchValidationError,
      details: {
        invalidRows: [{ index: 1, reasons: ['jersey_number_out_of_range'] }],
      },
    });
    expect(createTeams).not.toHaveBeenCalled();
    expect(createAssignments).not.toHaveBeenCalled();
    createTeams.mockRestore();
    createAssignments.mockRestore();
  });

  it('imports distinct Teams once, a master Player + assignment per row, reporting the count (Req 8.1, 8.2, 11.2)', async () => {
    const svc = new BatchUploadService(stubDb());

    const createTeams = vi
      .spyOn(teamRepository, 'createMany')
      .mockResolvedValue([
        { id: 't-warriors', seasonId: 's-1', name: 'Warriors' },
        { id: 't-lakers', seasonId: 's-1', name: 'Lakers' },
      ]);
    // One NEW master Player per row (master shape {id, name}), with known ids
    // so the assignment assertion below can check the pairing by row order.
    const createPlayers = vi
      .spyOn(playerRepository, 'createMany')
      .mockResolvedValue([
        { id: 'p-1', name: 'Alice' },
        { id: 'p-2', name: 'Bob' },
        { id: 'p-3', name: 'Carol' },
      ]);
    const createAssignments = vi
      .spyOn(rosterAssignmentRepository, 'createMany')
      .mockResolvedValue([
        { id: 'a-1', playerId: 'p-1', teamId: 't-warriors', jerseyNumber: 10 },
        { id: 'a-2', playerId: 'p-2', teamId: 't-warriors', jerseyNumber: 11 },
        { id: 'a-3', playerId: 'p-3', teamId: 't-lakers', jerseyNumber: 7 },
      ]);

    const result = await svc.uploadTeamsAndPlayers(admin, {
      seasonId: 's-1',
      file: csvFile(VALID_CSV),
    });

    // Two distinct Teams, created once.
    expect(createTeams).toHaveBeenCalledTimes(1);
    expect(createTeams.mock.calls[0]![0]).toEqual([
      { seasonId: 's-1', name: 'Warriors' },
      { seasonId: 's-1', name: 'Lakers' },
    ]);

    // One new master Player per row, master {name} shape only (no teamId/jersey).
    expect(createPlayers).toHaveBeenCalledTimes(1);
    expect(createPlayers.mock.calls[0]![0]).toEqual([
      { name: 'Alice' },
      { name: 'Bob' },
      { name: 'Carol' },
    ]);

    // One assignment per row, pairing each created master's returned id with
    // its row's Team and jersey number.
    expect(createAssignments).toHaveBeenCalledTimes(1);
    expect(createAssignments.mock.calls[0]![0]).toEqual([
      { playerId: 'p-1', teamId: 't-warriors', jerseyNumber: 10 },
      { playerId: 'p-2', teamId: 't-warriors', jerseyNumber: 11 },
      { playerId: 'p-3', teamId: 't-lakers', jerseyNumber: 7 },
    ]);

    expect(result).toEqual({
      teamsCreated: 2,
      playersCreated: 3,
      importedRecords: 5,
    });

    createTeams.mockRestore();
    createPlayers.mockRestore();
    createAssignments.mockRestore();
  });

  it('accepts an .xlsx file with the same result as CSV (Req 11.1)', async () => {
    const svc = new BatchUploadService(stubDb());
    const createTeams = vi
      .spyOn(teamRepository, 'createMany')
      .mockResolvedValue([{ id: 't-1', seasonId: 's-1', name: 'Warriors' }]);
    const createPlayers = vi
      .spyOn(playerRepository, 'createMany')
      .mockResolvedValue([{ id: 'p-1', name: 'Alice' }]);
    const createAssignments = vi
      .spyOn(rosterAssignmentRepository, 'createMany')
      .mockResolvedValue([
        { id: 'a-1', playerId: 'p-1', teamId: 't-1', jerseyNumber: 10 },
      ]);

    const file = xlsxFile([
      ['teamName', 'playerName', 'jerseyNumber'],
      ['Warriors', 'Alice', 10],
    ]);

    const result = await svc.uploadTeamsAndPlayers(admin, {
      seasonId: 's-1',
      file,
    });

    expect(createPlayers.mock.calls[0]![0]).toEqual([{ name: 'Alice' }]);
    expect(createAssignments.mock.calls[0]![0]).toEqual([
      { playerId: 'p-1', teamId: 't-1', jerseyNumber: 10 },
    ]);
    expect(result).toEqual({
      teamsCreated: 1,
      playersCreated: 1,
      importedRecords: 2,
    });
    createTeams.mockRestore();
    createPlayers.mockRestore();
    createAssignments.mockRestore();
  });
});

// ---------------------------------------------------------------------------
// Property-based tests (task 9.3)
//
// Driven with fast-check (min 100 runs), these verify the master-Player import
// behaviour of a *valid* Batch_Upload across many generated rosters, DB-less:
// `db.transaction` is stubbed and the Team / master Player / Roster_Assignment
// repositories are spied. See the Property 15 tag below for the exact claim.
// ---------------------------------------------------------------------------

/** A string of exactly `len` safe, CSV/jersey-friendly characters. */
function fixedString(len: number): fc.Arbitrary<string> {
  // Letters and digits only: avoids commas/newlines/quotes that would break the
  // generated CSV, and avoids leading/trailing whitespace the parser trims.
  return fc
    .array(
      fc.constantFrom(...'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789'.split('')),
      { minLength: len, maxLength: len },
    )
    .map((chars) => chars.join(''));
}

/** A name 1–100 characters long (the valid Player/Team name range). */
const nameArb: fc.Arbitrary<string> = fc
  .integer({ min: 1, max: 100 })
  .chain((len) => fixedString(len));

/**
 * A valid batch: a non-empty set of Teams with distinct case-insensitive names,
 * each carrying a non-empty set of players whose jerseys are unique within that
 * Team (0–99). This is exactly the input space `validateBatch` accepts, so the
 * generated CSV always imports.
 */
interface GenTeam {
  readonly name: string;
  readonly players: ReadonlyArray<{ name: string; jersey: number }>;
}

const validBatchArb: fc.Arbitrary<GenTeam[]> = fc
  .uniqueArray(nameArb, {
    minLength: 1,
    maxLength: 4,
    selector: (n) => n.toLowerCase(),
  })
  .chain((teamNames) =>
    fc.tuple(
      ...teamNames.map((name) =>
        fc
          .uniqueArray(fc.integer({ min: 0, max: 99 }), {
            minLength: 1,
            maxLength: 6,
          })
          .chain((jerseys) =>
            fc
              .tuple(...jerseys.map(() => nameArb))
              .map((playerNames) => ({
                name,
                players: jerseys.map((jersey, i) => ({
                  name: playerNames[i]!,
                  jersey,
                })),
              })),
          ),
      ),
    ),
  );

/** Flatten a generated batch into row order (teams in order, players in order). */
function flattenRows(
  batch: readonly GenTeam[],
): Array<{ teamName: string; playerName: string; jersey: number }> {
  return batch.flatMap((team) =>
    team.players.map((p) => ({
      teamName: team.name,
      playerName: p.name,
      jersey: p.jersey,
    })),
  );
}

/** Build the CSV text (header + a row per flattened entry) for a batch. */
function batchCsv(batch: readonly GenTeam[]): string {
  const header = 'teamName,playerName,jerseyNumber';
  const lines = flattenRows(batch).map(
    (r) => `${r.teamName},${r.playerName},${r.jersey}`,
  );
  return [header, ...lines].join('\n');
}

describe('BatchUploadService.uploadTeamsAndPlayers — property-based (Property 15)', () => {
  // Feature: player-master-data, Property 15: Batch creates a new master and assignment per row
  //
  // For any accepted Batch_Upload, the import creates exactly one new master
  // Player and exactly one Roster_Assignment per row (linking that new Player to
  // the row's Team with the row's jersey) and creates each distinct Team once;
  // two rows with identical player names produce two distinct master Players.
  //
  // Validates: Requirements 8.1, 8.3
  it('creates one new master and one assignment per row, dedupes Teams, and reports counts', async () => {
    await fc.assert(
      fc.asyncProperty(validBatchArb, async (batch) => {
        const rows = flattenRows(batch);

        // Distinct Teams in first-seen (case-insensitive) order. The generator
        // already makes team names case-insensitively unique, so this preserves
        // their generated order.
        const distinctTeams = batch.map((t) => t.name);
        const teamIdByKey = new Map<string, string>();
        distinctTeams.forEach((name, i) => {
          teamIdByKey.set(name.trim().toLowerCase(), `t-${i}`);
        });

        const svc = new BatchUploadService(stubDb());

        // Teams: return one created Team (with an id) per distinct input, in the
        // order the service passes them (first-seen).
        const createTeams = vi
          .spyOn(teamRepository, 'createMany')
          .mockResolvedValue(
            distinctTeams.map((name, i) => ({
              id: `t-${i}`,
              seasonId: 's-1',
              name,
            })),
          );
        // Masters: one new master Player per row, with a distinct id per row so
        // the assignment pairing can be checked by row order.
        const createPlayers = vi
          .spyOn(playerRepository, 'createMany')
          .mockResolvedValue(
            rows.map((r, i) => ({ id: `p-${i}`, name: r.playerName })),
          );
        const createAssignments = vi
          .spyOn(rosterAssignmentRepository, 'createMany')
          .mockResolvedValue([]);

        try {
          const result = await svc.uploadTeamsAndPlayers(admin, {
            seasonId: 's-1',
            file: csvFile(batchCsv(batch)),
          });

          // Teams deduplicated: created exactly once, one input per distinct
          // (case-insensitive) Team name.
          expect(createTeams).toHaveBeenCalledTimes(1);
          expect(createTeams.mock.calls[0]![0]).toEqual(
            distinctTeams.map((name) => ({ seasonId: 's-1', name })),
          );

          // Exactly one NEW master Player per row, master {name} shape only
          // (no teamId/jersey) — an existing master is never reused (Req 8.3).
          // Two rows with the same player name still yield two create entries.
          expect(createPlayers).toHaveBeenCalledTimes(1);
          const masterInputs = createPlayers.mock.calls[0]![0];
          expect(masterInputs).toEqual(rows.map((r) => ({ name: r.playerName })));
          expect(masterInputs).toHaveLength(rows.length);

          // Exactly one assignment per row, pairing each created master (by row
          // order) with its row's Team id and jersey number.
          expect(createAssignments).toHaveBeenCalledTimes(1);
          expect(createAssignments.mock.calls[0]![0]).toEqual(
            rows.map((r, i) => ({
              playerId: `p-${i}`,
              teamId: teamIdByKey.get(r.teamName.trim().toLowerCase())!,
              jerseyNumber: r.jersey,
            })),
          );

          // Counts: playersCreated === rows.length; importedRecords is the sum
          // of distinct Teams + players.
          expect(result.playersCreated).toBe(rows.length);
          expect(result.teamsCreated).toBe(distinctTeams.length);
          expect(result.importedRecords).toBe(
            result.teamsCreated + result.playersCreated,
          );
        } finally {
          createTeams.mockRestore();
          createPlayers.mockRestore();
          createAssignments.mockRestore();
        }
      }),
      { numRuns: 100 },
    );
  });
});
