/**
 * Statistics management page (Manage > Statistics) - Requirement 8.
 *
 * Two sections for an Administrator:
 *   1. Record a statistic: pick a Season -> Game -> Player, a Statistic_Type,
 *      and a value (0-999), then `statisticsApi.record` (Req 8.2-8.5). The
 *      server validates the type enum, value bounds, and player eligibility.
 *   2. View season totals: pick a Player or a Team and see per-type season
 *      totals via `statisticsApi.playerSeason` / `teamSeason` (Req 8.6-8.8).
 *
 * Games come from the management games read; players from the master registry;
 * teams from the season. The whole page is gated to Administrators.
 */
import { useCallback, useMemo, useState } from 'react';
import {
  Alert,
  Button,
  Card,
  Group,
  NumberInput,
  SegmentedControl,
  Select,
  Stack,
  Table,
  Text,
  Title,
} from '@mantine/core';
import { useForm } from '@mantine/form';
import { notifications } from '@mantine/notifications';

import {
  ApiError,
  gamesApi,
  statisticsApi,
  type GameSummary,
  type SeasonStatsPayload,
  type StatisticType,
} from '../../api/index.js';
import { useResourceList } from '../../hooks/useResourceList.js';
import { LeagueSelect } from '../../components/selectors/LeagueSelect.js';
import { SeasonSelect } from '../../components/selectors/SeasonSelect.js';
import { TeamSelect } from '../../components/selectors/TeamSelect.js';
import { PlayerSelect } from '../../components/selectors/PlayerSelect.js';
import classes from './ManageHome.module.css';

const STAT_TYPES: { value: StatisticType; label: string }[] = [
  { value: 'Points', label: 'Points' },
  { value: 'Assists', label: 'Assists' },
  { value: 'Rebounds', label: 'Rebounds' },
  { value: 'Steals', label: 'Steals' },
  { value: 'Blocks', label: 'Blocks' },
  { value: 'Three_Pointers_Made', label: '3-Pointers Made' },
];

function messageFor(error: unknown, fallback: string): string {
  return error instanceof ApiError ? error.message : fallback;
}

function gameLabel(g: GameSummary): string {
  const d = new Date(g.date);
  const date = Number.isNaN(d.getTime()) ? g.date : d.toLocaleDateString();
  return `${date}: ${g.homeTeamName || g.homeTeamId} vs ${g.awayTeamName || g.awayTeamId}`;
}

interface RecordValues {
  gameId: string | null;
  playerId: string | null;
  type: StatisticType;
  value: number | string;
}

export function StatisticsPage(): JSX.Element {
  const [leagueId, setLeagueId] = useState<string | null>(null);
  const [seasonId, setSeasonId] = useState<string | null>(null);

  // Games for the record section.
  const gamesKey = seasonId !== null ? `/seasons/${seasonId}/games` : null;
  const gamesLoader = useCallback(
    (signal: AbortSignal) => gamesApi.list(seasonId as string, signal),
    [seasonId],
  );
  const { items: games, loading: gamesLoading } = useResourceList<GameSummary>(gamesLoader, gamesKey);

  const recordForm = useForm<RecordValues>({
    initialValues: { gameId: null, playerId: null, type: 'Points', value: 0 },
    validate: {
      gameId: (v) => (v === null ? 'Select a game.' : null),
      playerId: (v) => (v === null ? 'Select a player.' : null),
      value: (v) => {
        const n = typeof v === 'number' ? v : Number(v);
        return Number.isInteger(n) && n >= 0 && n <= 999 ? null : 'Value must be 0-999.';
      },
    },
  });

  const handleRecord = recordForm.onSubmit(async (values) => {
    if (values.gameId === null || values.playerId === null) return;
    try {
      await statisticsApi.record({
        gameId: values.gameId,
        playerId: values.playerId,
        type: values.type,
        value: Number(values.value),
      });
      notifications.show({ color: 'green', title: 'Statistic recorded', message: 'Saved.' });
      recordForm.setFieldValue('value', 0);
    } catch (err: unknown) {
      notifications.show({
        color: 'red',
        title: 'Could not record the statistic',
        message: messageFor(err, 'Failed to record the statistic.'),
      });
    }
  });

  // Season totals viewer.
  const [subjectKind, setSubjectKind] = useState<'player' | 'team'>('player');
  const [viewPlayerId, setViewPlayerId] = useState<string | null>(null);
  const [viewTeamId, setViewTeamId] = useState<string | null>(null);
  const [totals, setTotals] = useState<SeasonStatsPayload | null>(null);
  const [viewLoading, setViewLoading] = useState(false);
  const [viewError, setViewError] = useState<string | null>(null);

  const loadTotals = useCallback(async () => {
    if (seasonId === null) return;
    const subjectId = subjectKind === 'player' ? viewPlayerId : viewTeamId;
    if (subjectId === null) return;
    setViewLoading(true);
    setViewError(null);
    setTotals(null);
    try {
      const payload =
        subjectKind === 'player'
          ? await statisticsApi.playerSeason(seasonId, subjectId)
          : await statisticsApi.teamSeason(seasonId, subjectId);
      setTotals(payload);
    } catch (err: unknown) {
      setViewError(messageFor(err, 'Failed to load season totals.'));
    } finally {
      setViewLoading(false);
    }
  }, [seasonId, subjectKind, viewPlayerId, viewTeamId]);

  const gameOptions = useMemo(
    () => games.map((g) => ({ value: g.id, label: gameLabel(g) })),
    [games],
  );

  const hasSeason = seasonId !== null;
  const canViewSubject =
    subjectKind === 'player' ? viewPlayerId !== null : viewTeamId !== null;

  return (
    <section aria-labelledby="stats-heading">
      <Stack gap="lg">
        <Title id="stats-heading" order={2} className={classes.title}>
          Statistics
        </Title>

        <Stack gap="sm" maw={420}>
          <LeagueSelect
            value={leagueId}
            onChange={(id) => {
              setLeagueId(id);
              setSeasonId(null);
              setTotals(null);
            }}
          />
          <SeasonSelect leagueId={leagueId} value={seasonId} onChange={setSeasonId} />
        </Stack>

        {hasSeason ? (
          <>
            <Card withBorder radius="md" padding="lg" maw={520}>
              <Stack gap="sm">
                <Title order={3}>Record a statistic</Title>
                <form onSubmit={handleRecord} noValidate>
                  <Stack gap="sm">
                    <Select
                      label="Game"
                      placeholder={gamesLoading ? 'Loading games...' : 'Select a game'}
                      data={gameOptions}
                      searchable
                      value={recordForm.values.gameId}
                      onChange={(v) => recordForm.setFieldValue('gameId', v)}
                      error={recordForm.errors.gameId}
                    />
                    <PlayerSelect
                      value={recordForm.values.playerId}
                      onChange={(id) => recordForm.setFieldValue('playerId', id)}
                      required
                    />
                    {recordForm.errors.playerId ? (
                      <Text role="alert" c="red" size="sm">{recordForm.errors.playerId}</Text>
                    ) : null}
                    <Select
                      label="Statistic type"
                      data={STAT_TYPES}
                      allowDeselect={false}
                      value={recordForm.values.type}
                      onChange={(v) => recordForm.setFieldValue('type', (v as StatisticType) ?? 'Points')}
                    />
                    <NumberInput label="Value" min={0} max={999} allowDecimal={false} {...recordForm.getInputProps('value')} />
                    <Group>
                      <Button type="submit" loading={recordForm.submitting}>Record</Button>
                    </Group>
                  </Stack>
                </form>
              </Stack>
            </Card>

            <Card withBorder radius="md" padding="lg" maw={520}>
              <Stack gap="sm">
                <Title order={3}>Season totals</Title>
                <SegmentedControl
                  data={[
                    { value: 'player', label: 'By player' },
                    { value: 'team', label: 'By team' },
                  ]}
                  value={subjectKind}
                  onChange={(v) => {
                    setSubjectKind(v as 'player' | 'team');
                    setTotals(null);
                    setViewError(null);
                  }}
                />
                {subjectKind === 'player' ? (
                  <PlayerSelect value={viewPlayerId} onChange={setViewPlayerId} label="Player" />
                ) : (
                  <TeamSelect seasonId={seasonId} value={viewTeamId} onChange={setViewTeamId} label="Team" />
                )}
                <Group>
                  <Button variant="light" onClick={() => void loadTotals()} loading={viewLoading} disabled={!canViewSubject}>
                    View totals
                  </Button>
                </Group>

                {viewError !== null ? (
                  <Alert role="alert" color="nba-red" title="Could not load totals">{viewError}</Alert>
                ) : null}

                {totals !== null ? (
                  <Table withTableBorder>
                    <Table.Thead>
                      <Table.Tr>
                        <Table.Th>Statistic</Table.Th>
                        <Table.Th>Season total</Table.Th>
                      </Table.Tr>
                    </Table.Thead>
                    <Table.Tbody>
                      {totals.totals.map((row) => (
                        <Table.Tr key={row.type}>
                          <Table.Td>{STAT_TYPES.find((s) => s.value === row.type)?.label ?? row.type}</Table.Td>
                          <Table.Td fw={700}>{row.total}</Table.Td>
                        </Table.Tr>
                      ))}
                    </Table.Tbody>
                  </Table>
                ) : null}
              </Stack>
            </Card>
          </>
        ) : (
          <Text role="status" c="dimmed">Select a league and a season to record or view statistics.</Text>
        )}
      </Stack>
    </section>
  );
}