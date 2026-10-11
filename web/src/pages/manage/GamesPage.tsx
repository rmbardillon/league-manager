/**
 * Games management page (Manage > Games) - Requirements 5 and 6.
 *
 * An Administrator picks a League then a Season, sees that Season's full game
 * list (all states, with scores), and can:
 *   - create a manual regular-season game (two distinct teams, date, start
 *     time, duration, venue) via `gamesApi.create` (Req 5.1);
 *   - reschedule a non-cancelled game via `gamesApi.reschedule` (Req 5.6);
 *   - cancel a game via `gamesApi.cancel` (Req 5.8);
 *   - record a final score (marks the game completed) or correct an existing
 *     score via `scoresApi.record` / `scoresApi.correct` (Req 6.1, 6.4).
 *
 * The server enforces distinct teams, duration bounds, the future-date rule,
 * venue conflicts, and score bounds; this view surfaces those errors inline or
 * as notifications. After each mutation the games list is refetched.
 *
 * The whole page is gated to Administrators by the route guard.
 */
import { useCallback, useMemo, useState } from 'react';
import {
  Alert,
  Badge,
  Button,
  Card,
  Group,
  Modal,
  NumberInput,
  Stack,
  Table,
  Text,
  TextInput,
  Title,
} from '@mantine/core';
import { useForm } from '@mantine/form';
import { notifications } from '@mantine/notifications';

import {
  ApiError,
  gamesApi,
  scoresApi,
  type GameSummary,
} from '../../api/index.js';
import { invalidate } from '../../api/resourceCache.js';
import { useResourceList } from '../../hooks/useResourceList.js';
import { LeagueSelect } from '../../components/selectors/LeagueSelect.js';
import { SeasonSelect } from '../../components/selectors/SeasonSelect.js';
import { TeamSelect } from '../../components/selectors/TeamSelect.js';
import classes from './ManageHome.module.css';

/** The message to show for a failed mutation (server message when available). */
function messageFor(error: unknown, fallback: string): string {
  return error instanceof ApiError ? error.message : fallback;
}

/** Color for a game-status badge. */
function statusColor(status: GameSummary['status']): string {
  if (status === 'completed') return 'green';
  if (status === 'cancelled') return 'gray';
  return 'nba-blue';
}

/** Render a game's date (ISO) as a short local date. */
function shortDate(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleDateString();
}

interface CreateGameValues {
  homeTeamId: string | null;
  awayTeamId: string | null;
  date: string;
  startTime: string;
  durationMinutes: number | string;
  venue: string;
}

interface RescheduleValues {
  date: string;
  startTime: string;
  durationMinutes: number | string;
  venue: string;
}

interface ScoreValues {
  homeScore: number | string;
  awayScore: number | string;
}

export function GamesPage(): JSX.Element {
  const [leagueId, setLeagueId] = useState<string | null>(null);
  const [seasonId, setSeasonId] = useState<string | null>(null);

  const [rescheduleTarget, setRescheduleTarget] = useState<GameSummary | null>(null);
  const [cancelTarget, setCancelTarget] = useState<GameSummary | null>(null);
  const [scoreTarget, setScoreTarget] = useState<GameSummary | null>(null);
  const [cancelling, setCancelling] = useState(false);
  const [cancelError, setCancelError] = useState<string | null>(null);

  const listKey = seasonId !== null ? `/seasons/${seasonId}/games` : null;
  const loader = useCallback(
    (signal: AbortSignal) => gamesApi.list(seasonId as string, signal),
    [seasonId],
  );
  const { items, loading, error, reload } = useResourceList<GameSummary>(loader, listKey);

  const refresh = useCallback(() => {
    if (listKey !== null) invalidate(listKey);
    reload();
  }, [listKey, reload]);

  const createForm = useForm<CreateGameValues>({
    initialValues: {
      homeTeamId: null,
      awayTeamId: null,
      date: '',
      startTime: '',
      durationMinutes: 60,
      venue: '',
    },
    validate: {
      homeTeamId: (v) => (v === null ? 'Select the home team.' : null),
      awayTeamId: (v, values) =>
        v === null
          ? 'Select the away team.'
          : v === values.homeTeamId
            ? 'The two teams must be distinct.'
            : null,
      date: (v) => (v.trim() === '' ? 'Select a date.' : null),
      startTime: (v) => (/^\d{1,2}:\d{2}$/.test(v.trim()) ? null : 'Use HH:MM (24-hour).'),
      durationMinutes: (v) => {
        const n = typeof v === 'number' ? v : Number(v);
        return Number.isInteger(n) && n >= 1 && n <= 480
          ? null
          : 'Duration must be 1-480 minutes.';
      },
      venue: (v) => (v.trim() === '' ? 'Enter a venue.' : null),
    },
  });

  const rescheduleForm = useForm<RescheduleValues>({
    initialValues: { date: '', startTime: '', durationMinutes: 60, venue: '' },
    validate: {
      date: (v) => (v.trim() === '' ? 'Select a date.' : null),
      startTime: (v) => (/^\d{1,2}:\d{2}$/.test(v.trim()) ? null : 'Use HH:MM (24-hour).'),
    },
  });

  const scoreForm = useForm<ScoreValues>({
    initialValues: { homeScore: 0, awayScore: 0 },
    validate: {
      homeScore: (v) => scoreBound(v),
      awayScore: (v) => scoreBound(v),
    },
  });

  const handleCreate = createForm.onSubmit(async (values) => {
    if (seasonId === null || values.homeTeamId === null || values.awayTeamId === null) {
      return;
    }
    try {
      await gamesApi.create({
        seasonId,
        homeTeamId: values.homeTeamId,
        awayTeamId: values.awayTeamId,
        date: values.date,
        startTime: values.startTime.trim(),
        durationMinutes: Number(values.durationMinutes),
        venue: values.venue.trim(),
      });
      refresh();
      createForm.reset();
      notifications.show({ color: 'green', title: 'Game scheduled', message: 'Created the game.' });
    } catch (err: unknown) {
      notifications.show({
        color: 'red',
        title: 'Could not schedule the game',
        message: messageFor(err, 'Failed to create the game.'),
      });
    }
  });

  const openReschedule = useCallback(
    (game: GameSummary) => {
      setRescheduleTarget(game);
      rescheduleForm.setValues({
        date: game.date.slice(0, 10),
        startTime: game.startTime ?? '',
        durationMinutes: game.durationMinutes ?? 60,
        venue: game.venue ?? '',
      });
      rescheduleForm.clearErrors();
    },
    [rescheduleForm],
  );

  const closeReschedule = useCallback(() => {
    setRescheduleTarget(null);
    rescheduleForm.reset();
  }, [rescheduleForm]);

  const handleReschedule = rescheduleForm.onSubmit(async (values) => {
    if (rescheduleTarget === null) return;
    try {
      await gamesApi.reschedule(rescheduleTarget.id, {
        date: values.date,
        startTime: values.startTime.trim(),
        durationMinutes: Number(values.durationMinutes),
        venue: values.venue.trim() === '' ? undefined : values.venue.trim(),
      });
      refresh();
      closeReschedule();
      notifications.show({ color: 'green', title: 'Game rescheduled', message: 'Updated the game.' });
    } catch (err: unknown) {
      notifications.show({
        color: 'red',
        title: 'Could not reschedule',
        message: messageFor(err, 'Failed to reschedule the game.'),
      });
    }
  });

  const openScore = useCallback(
    (game: GameSummary) => {
      setScoreTarget(game);
      scoreForm.setValues({
        homeScore: game.homeScore ?? 0,
        awayScore: game.awayScore ?? 0,
      });
      scoreForm.clearErrors();
    },
    [scoreForm],
  );

  const closeScore = useCallback(() => {
    setScoreTarget(null);
    scoreForm.reset();
  }, [scoreForm]);

  const handleScore = scoreForm.onSubmit(async (values) => {
    if (scoreTarget === null) return;
    const alreadyScored = scoreTarget.status === 'completed';
    try {
      const body = { homeScore: Number(values.homeScore), awayScore: Number(values.awayScore) };
      if (alreadyScored) {
        await scoresApi.correct(scoreTarget.id, body);
      } else {
        await scoresApi.record(scoreTarget.id, body);
      }
      refresh();
      closeScore();
      notifications.show({
        color: 'green',
        title: alreadyScored ? 'Score corrected' : 'Score recorded',
        message: 'Standings will reflect the result.',
      });
    } catch (err: unknown) {
      notifications.show({
        color: 'red',
        title: 'Could not save the score',
        message: messageFor(err, 'Failed to save the score.'),
      });
    }
  });

  const openCancel = useCallback((game: GameSummary) => {
    setCancelError(null);
    setCancelTarget(game);
  }, []);

  const closeCancel = useCallback(() => {
    setCancelTarget(null);
    setCancelError(null);
  }, []);

  const handleCancel = useCallback(async () => {
    if (cancelTarget === null) return;
    setCancelling(true);
    setCancelError(null);
    try {
      await gamesApi.cancel(cancelTarget.id);
      refresh();
      closeCancel();
      notifications.show({ color: 'green', title: 'Game cancelled', message: 'The record was retained.' });
    } catch (err: unknown) {
      const message = messageFor(err, 'Failed to cancel the game.');
      setCancelError(message);
      notifications.show({ color: 'red', title: 'Could not cancel', message });
    } finally {
      setCancelling(false);
    }
  }, [cancelTarget, refresh, closeCancel]);

  const hasSeason = seasonId !== null;
  const showEmpty = useMemo(
    () => hasSeason && !loading && error === null && items.length === 0,
    [hasSeason, loading, error, items.length],
  );

  return (
    <section aria-labelledby="games-heading">
      <Stack gap="lg">
        <Title id="games-heading" order={2} className={classes.title}>
          Games
        </Title>

        <Stack gap="sm" maw={420}>
          <LeagueSelect
            value={leagueId}
            onChange={(id) => {
              setLeagueId(id);
              setSeasonId(null);
            }}
          />
          <SeasonSelect leagueId={leagueId} value={seasonId} onChange={setSeasonId} />
        </Stack>

        {hasSeason ? (
          <>
            <section aria-labelledby="create-game-heading">
              <Card withBorder radius="md" padding="lg" maw={520}>
                <Stack gap="sm">
                  <Title id="create-game-heading" order={3}>
                    Schedule a Game
                  </Title>
                  <form onSubmit={handleCreate} noValidate>
                    <Stack gap="sm">
                      <TeamSelect
                        seasonId={seasonId}
                        value={createForm.values.homeTeamId}
                        onChange={(id) => createForm.setFieldValue('homeTeamId', id)}
                        label="Home team"
                        required
                      />
                      {createForm.errors.homeTeamId ? (
                        <Text role="alert" c="red" size="sm">{createForm.errors.homeTeamId}</Text>
                      ) : null}
                      <TeamSelect
                        seasonId={seasonId}
                        value={createForm.values.awayTeamId}
                        onChange={(id) => createForm.setFieldValue('awayTeamId', id)}
                        label="Away team"
                        required
                      />
                      {createForm.errors.awayTeamId ? (
                        <Text role="alert" c="red" size="sm">{createForm.errors.awayTeamId}</Text>
                      ) : null}
                      <TextInput label="Date" type="date" required {...createForm.getInputProps('date')} />
                      <TextInput label="Start time (HH:MM)" placeholder="18:30" required {...createForm.getInputProps('startTime')} />
                      <NumberInput label="Duration (minutes)" min={1} max={480} allowDecimal={false} required {...createForm.getInputProps('durationMinutes')} />
                      <TextInput label="Venue" required {...createForm.getInputProps('venue')} />
                      <Group>
                        <Button type="submit" loading={createForm.submitting}>Schedule Game</Button>
                      </Group>
                    </Stack>
                  </form>
                </Stack>
              </Card>
            </section>

            <section aria-labelledby="games-list-heading">
              <Stack gap="sm">
                <Title id="games-list-heading" order={3}>Season games</Title>

                {error !== null ? (
                  <Alert role="alert" color="nba-red" title="Failed to load games">
                    <Stack gap="xs" align="flex-start">
                      <Text size="sm">{error}</Text>
                      <Button size="xs" variant="light" onClick={reload}>Retry</Button>
                    </Stack>
                  </Alert>
                ) : null}
                {loading ? <Text role="status">Loading games...</Text> : null}
                {showEmpty ? (
                  <Text role="status" c="dimmed">No games yet. Schedule the first one above.</Text>
                ) : null}

                {!loading && error === null && items.length > 0 ? (
                  <Card withBorder radius="md" padding={0}>
                    <Table.ScrollContainer minWidth={760}>
                      <Table>
                        <Table.Thead>
                          <Table.Tr>
                            <Table.Th>Date</Table.Th>
                            <Table.Th>Time</Table.Th>
                            <Table.Th>Home</Table.Th>
                            <Table.Th>Away</Table.Th>
                            <Table.Th>Venue</Table.Th>
                            <Table.Th>Status</Table.Th>
                            <Table.Th>Score</Table.Th>
                            <Table.Th>Actions</Table.Th>
                          </Table.Tr>
                        </Table.Thead>
                        <Table.Tbody>
                          {items.map((game) => {
                            const cancelled = game.status === 'cancelled';
                            const scored = game.status === 'completed';
                            return (
                              <Table.Tr key={game.id}>
                                <Table.Td>{shortDate(game.date)}</Table.Td>
                                <Table.Td>{game.startTime ?? 'TBD'}</Table.Td>
                                <Table.Td>{game.homeTeamName || game.homeTeamId}</Table.Td>
                                <Table.Td>{game.awayTeamName || game.awayTeamId}</Table.Td>
                                <Table.Td>{game.venue ?? 'TBD'}</Table.Td>
                                <Table.Td>
                                  <Badge color={statusColor(game.status)} variant="light" radius="sm">
                                    {game.status}
                                  </Badge>
                                </Table.Td>
                                <Table.Td>
                                  {scored ? `${game.homeScore} - ${game.awayScore}` : '-'}
                                </Table.Td>
                                <Table.Td>
                                  <Group gap="xs">
                                    <Button
                                      size="xs"
                                      variant="light"
                                      onClick={() => openScore(game)}
                                      disabled={cancelled}
                                    >
                                      {scored ? 'Correct score' : 'Record score'}
                                    </Button>
                                    <Button
                                      size="xs"
                                      variant="light"
                                      onClick={() => openReschedule(game)}
                                      disabled={cancelled}
                                    >
                                      Reschedule
                                    </Button>
                                    <Button
                                      size="xs"
                                      variant="light"
                                      color="nba-red"
                                      onClick={() => openCancel(game)}
                                      disabled={cancelled}
                                    >
                                      Cancel
                                    </Button>
                                  </Group>
                                </Table.Td>
                              </Table.Tr>
                            );
                          })}
                        </Table.Tbody>
                      </Table>
                    </Table.ScrollContainer>
                  </Card>
                ) : null}
              </Stack>
            </section>
          </>
        ) : (
          <Text role="status" c="dimmed">Select a league and a season to manage its games.</Text>
        )}
      </Stack>

      {/* Reschedule modal. */}
      <Modal opened={rescheduleTarget !== null} onClose={closeReschedule} title="Reschedule game">
        <form onSubmit={handleReschedule} noValidate>
          <Stack gap="sm">
            <TextInput label="Date" type="date" required data-autofocus {...rescheduleForm.getInputProps('date')} />
            <TextInput label="Start time (HH:MM)" placeholder="18:30" required {...rescheduleForm.getInputProps('startTime')} />
            <NumberInput label="Duration (minutes)" min={1} max={480} allowDecimal={false} {...rescheduleForm.getInputProps('durationMinutes')} />
            <TextInput label="Venue" {...rescheduleForm.getInputProps('venue')} />
            <Group justify="flex-end">
              <Button variant="default" type="button" onClick={closeReschedule}>Cancel</Button>
              <Button type="submit" loading={rescheduleForm.submitting}>Save</Button>
            </Group>
          </Stack>
        </form>
      </Modal>

      {/* Score modal. */}
      <Modal
        opened={scoreTarget !== null}
        onClose={closeScore}
        title={scoreTarget?.status === 'completed' ? 'Correct score' : 'Record score'}
      >
        <form onSubmit={handleScore} noValidate>
          <Stack gap="sm">
            <Text size="sm" c="dimmed">
              {scoreTarget ? `${scoreTarget.homeTeamName} vs ${scoreTarget.awayTeamName}` : ''}
            </Text>
            <NumberInput label="Home score" min={0} max={999} allowDecimal={false} data-autofocus {...scoreForm.getInputProps('homeScore')} />
            <NumberInput label="Away score" min={0} max={999} allowDecimal={false} {...scoreForm.getInputProps('awayScore')} />
            <Group justify="flex-end">
              <Button variant="default" type="button" onClick={closeScore}>Cancel</Button>
              <Button type="submit" loading={scoreForm.submitting}>Save score</Button>
            </Group>
          </Stack>
        </form>
      </Modal>

      {/* Cancel confirm modal. */}
      <Modal opened={cancelTarget !== null} onClose={closeCancel} title="Cancel game">
        <Stack gap="sm">
          <Text>
            Cancel the game between &quot;{cancelTarget?.homeTeamName}&quot; and &quot;
            {cancelTarget?.awayTeamName}&quot;? The record is retained.
          </Text>
          {cancelError !== null ? (
            <Alert role="alert" color="nba-red" title="Could not cancel">{cancelError}</Alert>
          ) : null}
          <Group justify="flex-end">
            <Button variant="default" type="button" onClick={closeCancel}>Keep game</Button>
            <Button color="nba-red" onClick={() => void handleCancel()} loading={cancelling}>Cancel game</Button>
          </Group>
        </Stack>
      </Modal>
    </section>
  );
}

/** Validate a 0-999 integer score field. */
function scoreBound(value: number | string): string | null {
  const n = typeof value === 'number' ? value : Number(value);
  return Number.isInteger(n) && n >= 0 && n <= 999 ? null : 'Score must be 0-999.';
}