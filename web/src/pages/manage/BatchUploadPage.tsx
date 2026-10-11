/**
 * Batch Upload page (Manage > Batch Upload) - Requirement 11.
 *
 * An Administrator imports a Season's Teams and Players from a single CSV or
 * .xlsx file. The file carries one row per player with three columns - team
 * name, player name, and jersey number (0-99). Teams are created and
 * deduplicated automatically; every row creates a new master player and a
 * roster assignment. The import is all-or-nothing: one invalid row rejects the
 * whole file and imports nothing, and the per-row reasons are shown so the user
 * can fix the file and retry.
 *
 * The file is read in the browser, base64-encoded, and posted to
 * `POST /seasons/:seasonId/batch-upload`. The endpoint is Administrator-scoped,
 * so the whole page is gated to Administrators by the route guard.
 */
import { useCallback, useState } from 'react';
import {
  Alert,
  Button,
  Card,
  Code,
  List,
  Stack,
  Table,
  Text,
  Title,
} from '@mantine/core';
import { notifications } from '@mantine/notifications';

import { ApiError, batchApi, type BatchUploadResult } from '../../api/index.js';
import { invalidate } from '../../api/resourceCache.js';
import { LeagueSelect } from '../../components/selectors/LeagueSelect.js';
import { SeasonSelect } from '../../components/selectors/SeasonSelect.js';
import classes from './ManageHome.module.css';

/** Zero-based row reason codes the backend returns, mapped to readable text. */
const REASON_LABELS: Record<string, string> = {
  missing_team_name: 'Team name is missing',
  missing_player_name: 'Player name is missing',
  missing_jersey_number: 'Jersey number is missing',
  team_name_length_out_of_range: 'Team name must be 1-100 characters',
  player_name_length_out_of_range: 'Player name must be 1-100 characters',
  malformed_jersey_number: 'Jersey number is not a whole number',
  jersey_number_out_of_range: 'Jersey number must be between 0 and 99',
  duplicate_jersey_in_team: 'Duplicate jersey number within the same team',
};

interface InvalidRow {
  index: number;
  reasons: string[];
}

/** Extract the per-row invalid report from a BatchValidationError's details. */
function invalidRowsFrom(error: unknown): InvalidRow[] | null {
  if (!(error instanceof ApiError)) return null;
  const details = error.details;
  if (typeof details !== 'object' || details === null || !('invalidRows' in details)) {
    return null;
  }
  const rows = (details as { invalidRows: unknown }).invalidRows;
  if (!Array.isArray(rows)) return null;
  return rows
    .filter(
      (r): r is { index: number; reasons: string[] } =>
        typeof r === 'object' &&
        r !== null &&
        typeof (r as { index: unknown }).index === 'number' &&
        Array.isArray((r as { reasons: unknown }).reasons),
    )
    .map((r) => ({ index: r.index, reasons: r.reasons }));
}

/** Read a File as a base64 string (no data: prefix). */
async function fileToBase64(file: File): Promise<string> {
  const buffer = await file.arrayBuffer();
  const bytes = new Uint8Array(buffer);
  let binary = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

export function BatchUploadPage(): JSX.Element {
  const [leagueId, setLeagueId] = useState<string | null>(null);
  const [seasonId, setSeasonId] = useState<string | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const [result, setResult] = useState<BatchUploadResult | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [invalidRows, setInvalidRows] = useState<InvalidRow[] | null>(null);

  const reset = useCallback(() => {
    setResult(null);
    setErrorMessage(null);
    setInvalidRows(null);
  }, []);

  const handleUpload = useCallback(async () => {
    if (seasonId === null || file === null) {
      return;
    }
    setUploading(true);
    reset();
    try {
      const fileBase64 = await fileToBase64(file);
      const uploaded = await batchApi.upload(seasonId, {
        fileBase64,
        filename: file.name,
        mimeType: file.type || undefined,
      });
      // New Teams/Players landed; drop any cached season-scoped lists so the
      // other management views reflect the import.
      invalidate(`/seasons/${seasonId}/teams`);
      invalidate('/players');
      setResult(uploaded);
      setFile(null);
      notifications.show({
        color: 'green',
        title: 'Import complete',
        message: `Imported ${uploaded.teamsCreated} team(s) and ${uploaded.playersCreated} player(s).`,
      });
    } catch (err: unknown) {
      const rows = invalidRowsFrom(err);
      if (rows !== null && rows.length > 0) {
        setInvalidRows(rows);
      }
      const message =
        err instanceof ApiError ? err.message : 'The upload failed. Please try again.';
      setErrorMessage(message);
      notifications.show({ color: 'red', title: 'Import failed', message });
    } finally {
      setUploading(false);
    }
  }, [seasonId, file, reset]);

  const canUpload = seasonId !== null && file !== null && !uploading;

  return (
    <section aria-labelledby="batch-heading">
      <Stack gap="lg">
        <Title id="batch-heading" order={2} className={classes.title}>
          Batch Upload
        </Title>

        <Card withBorder radius="md" padding="lg" maw={640}>
          <Stack gap="xs">
            <Title order={3}>File format</Title>
            <Text size="sm" c="dimmed">
              Upload a CSV or Excel (.xlsx) file with a header row and one row
              per player. Three columns are required:
            </Text>
            <List size="sm" spacing={2}>
              <List.Item>
                <Code>teamName</Code> - the team to add the player to (teams are
                created automatically)
              </List.Item>
              <List.Item>
                <Code>playerName</Code> - the player&apos;s name (1-100 characters)
              </List.Item>
              <List.Item>
                <Code>jerseyNumber</Code> - a whole number 0-99, unique within a team
              </List.Item>
            </List>
            <Text size="sm" c="dimmed">
              The import is all-or-nothing: if any row is invalid, nothing is
              imported and the failing rows are listed below.
            </Text>
          </Stack>
        </Card>

        <Card withBorder radius="md" padding="lg" maw={420}>
          <Stack gap="sm">
            <LeagueSelect
              value={leagueId}
              onChange={(id) => {
                setLeagueId(id);
                setSeasonId(null);
                reset();
              }}
            />
            <SeasonSelect
              leagueId={leagueId}
              value={seasonId}
              onChange={(id) => {
                setSeasonId(id);
                reset();
              }}
            />

            <Stack gap={4}>
              <Text component="label" htmlFor="batch-file" fw={500} size="sm">
                File (CSV or .xlsx)
              </Text>
              <input
                id="batch-file"
                type="file"
                accept=".csv,.xlsx"
                onChange={(event) => {
                  setFile(event.currentTarget.files?.[0] ?? null);
                  reset();
                }}
              />
            </Stack>

            <Button onClick={() => void handleUpload()} loading={uploading} disabled={!canUpload}>
              Upload
            </Button>
          </Stack>
        </Card>

        {result !== null ? (
          <Alert color="green" title="Import complete" maw={640}>
            Imported <strong>{result.teamsCreated}</strong> team(s) and{' '}
            <strong>{result.playersCreated}</strong> player(s) (
            {result.importedRecords} records total).
          </Alert>
        ) : null}

        {errorMessage !== null ? (
          <Alert role="alert" color="nba-red" title="Import failed" maw={640}>
            <Stack gap="sm">
              <Text size="sm">{errorMessage}</Text>
              {invalidRows !== null && invalidRows.length > 0 ? (
                <Table withTableBorder>
                  <Table.Thead>
                    <Table.Tr>
                      <Table.Th>Row</Table.Th>
                      <Table.Th>Problem(s)</Table.Th>
                    </Table.Tr>
                  </Table.Thead>
                  <Table.Tbody>
                    {invalidRows.map((row) => (
                      <Table.Tr key={row.index}>
                        {/* +2: row 0 is the first data row below the header. */}
                        <Table.Td>Row {row.index + 2}</Table.Td>
                        <Table.Td>
                          {row.reasons.map((r) => REASON_LABELS[r] ?? r).join('; ')}
                        </Table.Td>
                      </Table.Tr>
                    ))}
                  </Table.Tbody>
                </Table>
              ) : null}
            </Stack>
          </Alert>
        ) : null}
      </Stack>
    </section>
  );
}