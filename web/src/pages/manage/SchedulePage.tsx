/**
 * Automatic schedule management page (Manage > Schedule) - Requirement 12.
 *
 * The draft-then-submit workflow for an Administrator:
 *   1. Generate a round-robin Draft_Schedule for a Season over a date range,
 *      selected playable weekdays, single/double round-robin, and a per-day
 *      game cap (`scheduleApi.generate`). Insufficient capacity is reported by
 *      the server as a CapacityError and surfaced here (Req 12.18).
 *   2. Review the generated draft games (drawn from the management games read,
 *      filtered to draft state). Assign each draft game a venue + start time
 *      (`scheduleApi.assign`, Req 12.11).
 *   3. Regenerate to discard and rebuild the draft (Req 12.16), or Submit to
 *      flip every draft game to official so Viewers can see it (Req 12.17).
 *
 * Draft games are not visible on the public Schedule until submitted. The whole
 * page is gated to Administrators by the route guard.
 */
import { useCallback, useMemo, useState } from 'react';
import {
  Alert,
  Badge,
  Button,
  Card,
  Checkbox,
  Group,
  Modal,
  NumberInput,
  Select,
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
  scheduleApi,
  type GameSummary,
  type PlayableDay,
} from '../../api/index.js';
import { invalidate } from '../../api/resourceCache.js';
import { useResourceList } from '../../hooks/useResourceList.js';
import { LeagueSelect } from '../../components/selectors/LeagueSelect.js';
import { SeasonSelect } from '../../components/selectors/SeasonSelect.js';
import classes from './ManageHome.module.css';

const DAYS: PlayableDay[] = [
  'Monday',
  'Tuesday',
  'Wednesday',
  'Thursday',
  'Friday',
  'Saturday',
  'Sunday',
];

function messageFor(error: unknown, fallback: string): string {
  return error instanceof ApiError ? error.message : fallback;
}

function shortDate(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleDateString();
}

interface GenerateValues {
  startDate: string;
  endDate: string;
  playableDays: PlayableDay[];
  roundRobinKind: 'single' | 'double';
  gamesPerDay: number | string;
}

interface AssignValues {
  venue: string;
  startTime: string;
  durationMinutes: number | string;
}

export function SchedulePage(): JSX.Element {
  const [leagueId, setLeagueId] = useState<string | null>(null);
  const [seasonId, setSeasonId] = useState<string | null>(null);
  const [generating, setGenerating] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [assignTarget, setAssignTarget] = useState<GameSummary | null>(null);

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

  const draftGames = useMemo(
    () => items.filter((g) => g.scheduleState === 'draft'),
    [items],
  );
  const officialCount = items.length - draftGames.length;

  const form = useForm<GenerateValues>({
    initialValues: {
      startDate: '',
      endDate: '',
      playableDays: ['Saturday', 'Sunday'],
      roundRobinKind: 'single',
      gamesPerDay: 4,
    },
    validate: {
      startDate: (v) => (v.trim() === '' ? 'Select a start date.' : null),
      endDate: (v, values) =>
        v.trim() === ''
          ? 'Select an end date.'
          : values.startDate && v < values.startDate
            ? 'End date must be on or after the start date.'
            : null,
      playableDays: (v) => (v.length === 0 ? 'Select at least one playable day.' : null),
      gamesPerDay: (v) => {
        const n = typeof v === 'number' ? v : Number(v);
        return Number.isInteger(n) && n >= 1 ? null : 'Games per day must be a positive integer.';
      },
    },
  });

  const assignForm = useForm<AssignValues>({
    initialValues: { venue: '', startTime: '', durationMinutes: 60 },
    validate: {
      venue: (v) => (v.trim() === '' ? 'Enter a venue.' : null),
      startTime: (v) => (/^\d{1,2}:\d{2}$/.test(v.trim()) ? null : 'Use HH:MM (24-hour).'),
    },
  });

  const runGenerate = useCallback(
    async (mode: 'generate' | 'regenerate', values: GenerateValues) => {
      if (seasonId === null) return;
      setGenerating(true);
      try {
        const body = {
          startDate: values.startDate,
          endDate: values.endDate,
          playableDays: values.playableDays,
          roundRobinKind: values.roundRobinKind,
          gamesPerDay: Number(values.gamesPerDay),
        };
        const res =
          mode === 'generate'
            ? await scheduleApi.generate(seasonId, body)
            : await scheduleApi.regenerate(seasonId, body);
        refresh();
        notifications.show({
          color: 'green',
          title: mode === 'generate' ? 'Draft generated' : 'Draft regenerated',
          message: `${res.games.length} draft game(s) created.`,
        });
      } catch (err: unknown) {
        notifications.show({
          color: 'red',
          title: 'Could not generate the schedule',
          message: messageFor(err, 'Failed to generate the schedule.'),
        });
      } finally {
        setGenerating(false);
      }
    },
    [seasonId, refresh],
  );

  const handleGenerate = form.onSubmit((values) => {
    void runGenerate(draftGames.length > 0 ? 'regenerate' : 'generate', values);
  });

  const openAssign = useCallback(
    (game: GameSummary) => {
      setAssignTarget(game);
      assignForm.setValues({
        venue: game.venue ?? '',
        startTime: game.startTime ?? '',
        durationMinutes: game.durationMinutes ?? 60,
      });
      assignForm.clearErrors();
    },
    [assignForm],
  );

  const closeAssign = useCallback(() => {
    setAssignTarget(null);
    assignForm.reset();
  }, [assignForm]);

  const handleAssign = assignForm.onSubmit(async (values) => {
    if (assignTarget === null) return;
    try {
      await scheduleApi.assign(assignTarget.id, {
        venue: values.venue.trim(),
        startTime: values.startTime.trim(),
        durationMinutes: Number(values.durationMinutes),
      });
      refresh();
      closeAssign();
      notifications.show({ color: 'green', title: 'Assigned', message: 'Venue and time set.' });
    } catch (err: unknown) {
      notifications.show({
        color: 'red',
        title: 'Could not assign',
        message: messageFor(err, 'Failed to assign venue and time.'),
      });
    }
  });

  const handleSubmit = useCallback(async () => {
    if (seasonId === null) return;
    setSubmitting(true);
    try {
      const res = await scheduleApi.submit(seasonId);
      refresh();
      notifications.show({
        color: 'green',
        title: 'Schedule submitted',
        message: `${res.games.length} game(s) are now official.`,
      });
    } catch (err: unknown) {
      notifications.show({
        color: 'red',
        title: 'Could not submit',
        message: messageFor(err, 'Failed to submit the schedule.'),
      });
    } finally {
      setSubmitting(false);
    }
  }, [seasonId, refresh]);

  const unassignedDrafts = draftGames.filter((g) => g.venue === null || g.startTime === null).length;
  const hasSeason = seasonId !== null;

  return (
    <section aria-labelledby="autosched-heading">
      <Stack gap="lg">
        <Title id="autosched-heading" order={2} className={classes.title}>
          Schedule
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
            <Card withBorder radius="md" padding="lg" maw={520}>
              <Stack gap="sm">
                <Title order={3}>Generate a draft schedule</Title>
                <form onSubmit={handleGenerate} noValidate>
                  <Stack gap="sm">
                    <Group grow>
                      <TextInput label="Start date" type="date" required {...form.getInputProps('startDate')} />
                      <TextInput label="End date" type="date" required {...form.getInputProps('endDate')} />
                    </Group>
                    <Stack gap={4}>
                      <Text fw={500} size="sm">Playable days</Text>
                      <Checkbox.Group {...form.getInputProps('playableDays')}>
                        <Group gap="sm">
                          {DAYS.map((d) => (
                            <Checkbox key={d} value={d} label={d.slice(0, 3)} />
                          ))}
                        </Group>
                      </Checkbox.Group>
                      {form.errors.playableDays ? (
                        <Text role="alert" c="red" size="sm">{form.errors.playableDays}</Text>
                      ) : null}
                    </Stack>
                    <Select
                      label="Round-robin"
                      data={[
                        { value: 'single', label: 'Single (each pair once)' },
                        { value: 'double', label: 'Double (home and away)' },
                      ]}
                      allowDeselect={false}
                      {...form.getInputProps('roundRobinKind')}
                    />
                    <NumberInput label="Games per day" min={1} allowDecimal={false} required {...form.getInputProps('gamesPerDay')} />
                    <Group>
                      <Button type="submit" loading={generating}>
                        {draftGames.length > 0 ? 'Regenerate draft' : 'Generate draft'}
                      </Button>
                    </Group>
                  </Stack>
                </form>
              </Stack>
            </Card>

            <section aria-labelledby="draft-list-heading">
              <Stack gap="sm">
                <Group justify="space-between" align="flex-end">
                  <Title id="draft-list-heading" order={3}>Draft games</Title>
                  <Button
                    onClick={() => void handleSubmit()}
                    loading={submitting}
                    disabled={draftGames.length === 0 || unassignedDrafts > 0}
                  >
                    Submit schedule
                  </Button>
                </Group>

                {officialCount > 0 ? (
                  <Badge color="green" variant="light" radius="sm" style={{ width: 'fit-content' }}>
                    {officialCount} official game(s) already submitted
                  </Badge>
                ) : null}
                {draftGames.length > 0 && unassignedDrafts > 0 ? (
                  <Text size="sm" c="dimmed">
                    Assign a venue and start time to all {unassignedDrafts} unassigned draft game(s)
                    before submitting.
                  </Text>
                ) : null}

                {error !== null ? (
                  <Alert role="alert" color="nba-red" title="Failed to load games">
                    <Stack gap="xs" align="flex-start">
                      <Text size="sm">{error}</Text>
                      <Button size="xs" variant="light" onClick={reload}>Retry</Button>
                    </Stack>
                  </Alert>
                ) : null}
                {loading ? <Text role="status">Loading draft...</Text> : null}
                {!loading && error === null && draftGames.length === 0 ? (
                  <Text role="status" c="dimmed">
                    No draft games. Generate a draft above.
                  </Text>
                ) : null}

                {draftGames.length > 0 ? (
                  <Card withBorder radius="md" padding={0}>
                    <Table.ScrollContainer minWidth={680}>
                      <Table>
                        <Table.Thead>
                          <Table.Tr>
                            <Table.Th>Date</Table.Th>
                            <Table.Th>Time</Table.Th>
                            <Table.Th>Home</Table.Th>
                            <Table.Th>Away</Table.Th>
                            <Table.Th>Venue</Table.Th>
                            <Table.Th>Actions</Table.Th>
                          </Table.Tr>
                        </Table.Thead>
                        <Table.Tbody>
                          {draftGames.map((game) => (
                            <Table.Tr key={game.id}>
                              <Table.Td>{shortDate(game.date)}</Table.Td>
                              <Table.Td>{game.startTime ?? 'TBD'}</Table.Td>
                              <Table.Td>{game.homeTeamName || game.homeTeamId}</Table.Td>
                              <Table.Td>{game.awayTeamName || game.awayTeamId}</Table.Td>
                              <Table.Td>{game.venue ?? 'TBD'}</Table.Td>
                              <Table.Td>
                                <Button size="xs" variant="light" onClick={() => openAssign(game)}>
                                  Assign venue/time
                                </Button>
                              </Table.Td>
                            </Table.Tr>
                          ))}
                        </Table.Tbody>
                      </Table>
                    </Table.ScrollContainer>
                  </Card>
                ) : null}
              </Stack>
            </section>
          </>
        ) : (
          <Text role="status" c="dimmed">Select a league and a season to generate a schedule.</Text>
        )}
      </Stack>

      <Modal opened={assignTarget !== null} onClose={closeAssign} title="Assign venue and time">
        <form onSubmit={handleAssign} noValidate>
          <Stack gap="sm">
            <Text size="sm" c="dimmed">
              {assignTarget ? `${assignTarget.homeTeamName} vs ${assignTarget.awayTeamName}` : ''}
            </Text>
            <TextInput label="Venue" required data-autofocus {...assignForm.getInputProps('venue')} />
            <TextInput label="Start time (HH:MM)" placeholder="18:30" required {...assignForm.getInputProps('startTime')} />
            <NumberInput label="Duration (minutes)" min={1} max={480} allowDecimal={false} {...assignForm.getInputProps('durationMinutes')} />
            <Group justify="flex-end">
              <Button variant="default" type="button" onClick={closeAssign}>Cancel</Button>
              <Button type="submit" loading={assignForm.submitting}>Save</Button>
            </Group>
          </Stack>
        </form>
      </Modal>
    </section>
  );
}