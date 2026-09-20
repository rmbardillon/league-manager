import { describe, it, expect, vi } from 'vitest';
import * as XLSX from 'xlsx';

import {
  BatchUploadService,
  type UploadedFile,
} from './batchUploadService.js';
import { AuthorizationError, BatchValidationError } from '../domain/errors.js';
import type { AuthUser } from '../domain/authorize.js';
import type { Database, Transaction } from '../repositories/executor.js';
import { playerRepository, teamRepository } from '../repositories/index.js';

/**
 * BatchUploadService unit tests (Task 18.1).
 *
 * These exercise the service without a real database: `db.transaction` is
 * stubbed to invoke the callback with a marker transaction, and the Team/Player
 * repositories are spied so we can assert what would be written. They verify:
 *   - Administrator-only authorization (Req 11.1)
 *   - CSV and .xlsx are accepted; other formats are rejected (Req 11.1, 11.5)
 *   - an empty file (no data rows) is rejected (Req 11.6)
 *   - any invalid row rejects the whole upload with a per-row report (Req 11.3)
 *   - a valid upload imports distinct Teams once + all Players, and reports the
 *     record count (Req 11.2)
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
    const create = vi.spyOn(teamRepository, 'createMany');

    await expect(
      svc.uploadTeamsAndPlayers(viewer, {
        seasonId: 's-1',
        file: csvFile(VALID_CSV),
      }),
    ).rejects.toBeInstanceOf(AuthorizationError);
    expect(create).not.toHaveBeenCalled();
    create.mockRestore();
  });

  it('rejects an unsupported file format and imports nothing (Req 11.5)', async () => {
    const svc = new BatchUploadService(stubDb());
    const create = vi.spyOn(teamRepository, 'createMany');

    await expect(
      svc.uploadTeamsAndPlayers(admin, {
        seasonId: 's-1',
        file: { buffer: Buffer.from('{}'), filename: 'roster.json' },
      }),
    ).rejects.toBeInstanceOf(BatchValidationError);
    expect(create).not.toHaveBeenCalled();
    create.mockRestore();
  });

  it('rejects a file with no data rows as empty (Req 11.6)', async () => {
    const svc = new BatchUploadService(stubDb());
    const create = vi.spyOn(teamRepository, 'createMany');

    await expect(
      svc.uploadTeamsAndPlayers(admin, {
        seasonId: 's-1',
        file: csvFile('teamName,playerName,jerseyNumber\n'),
      }),
    ).rejects.toBeInstanceOf(BatchValidationError);
    expect(create).not.toHaveBeenCalled();
    create.mockRestore();
  });

  it('rejects the whole upload with a per-row report when a row is invalid (Req 11.3)', async () => {
    const svc = new BatchUploadService(stubDb());
    const create = vi.spyOn(teamRepository, 'createMany');
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
    expect(create).not.toHaveBeenCalled();
    create.mockRestore();
  });

  it('imports distinct Teams once and all Players, reporting the count (Req 11.2)', async () => {
    const svc = new BatchUploadService(stubDb());

    const createTeams = vi
      .spyOn(teamRepository, 'createMany')
      .mockResolvedValue([
        { id: 't-warriors', seasonId: 's-1', name: 'Warriors' },
        { id: 't-lakers', seasonId: 's-1', name: 'Lakers' },
      ]);
    const createPlayers = vi
      .spyOn(playerRepository, 'createMany')
      .mockResolvedValue([
        { id: 'p-1', teamId: 't-warriors', name: 'Alice', jerseyNumber: 10 },
        { id: 'p-2', teamId: 't-warriors', name: 'Bob', jerseyNumber: 11 },
        { id: 'p-3', teamId: 't-lakers', name: 'Carol', jerseyNumber: 7 },
      ]);

    const result = await svc.uploadTeamsAndPlayers(admin, {
      seasonId: 's-1',
      file: csvFile(VALID_CSV),
    });

    // Two distinct Teams, three Players.
    expect(createTeams).toHaveBeenCalledTimes(1);
    expect(createTeams.mock.calls[0]![0]).toEqual([
      { seasonId: 's-1', name: 'Warriors' },
      { seasonId: 's-1', name: 'Lakers' },
    ]);
    expect(createPlayers).toHaveBeenCalledTimes(1);
    expect(createPlayers.mock.calls[0]![0]).toEqual([
      { teamId: 't-warriors', name: 'Alice', jerseyNumber: 10 },
      { teamId: 't-warriors', name: 'Bob', jerseyNumber: 11 },
      { teamId: 't-lakers', name: 'Carol', jerseyNumber: 7 },
    ]);
    expect(result).toEqual({
      teamsCreated: 2,
      playersCreated: 3,
      importedRecords: 5,
    });

    createTeams.mockRestore();
    createPlayers.mockRestore();
  });

  it('accepts an .xlsx file with the same result as CSV (Req 11.1)', async () => {
    const svc = new BatchUploadService(stubDb());
    const createTeams = vi
      .spyOn(teamRepository, 'createMany')
      .mockResolvedValue([{ id: 't-1', seasonId: 's-1', name: 'Warriors' }]);
    const createPlayers = vi
      .spyOn(playerRepository, 'createMany')
      .mockResolvedValue([
        { id: 'p-1', teamId: 't-1', name: 'Alice', jerseyNumber: 10 },
      ]);

    const file = xlsxFile([
      ['teamName', 'playerName', 'jerseyNumber'],
      ['Warriors', 'Alice', 10],
    ]);

    const result = await svc.uploadTeamsAndPlayers(admin, {
      seasonId: 's-1',
      file,
    });

    expect(result).toEqual({
      teamsCreated: 1,
      playersCreated: 1,
      importedRecords: 2,
    });
    createTeams.mockRestore();
    createPlayers.mockRestore();
  });
});
