/**
 * Automatic schedule management page (Manage > Schedule) - Requirement 12,
 * with manual draft adjustment.
 *
 * Workflow for an Administrator:
 *   1. Generate a round-robin Draft_Schedule for a Season (date range, playable
 *      weekdays, single/double, per-day cap). `scheduleApi.generate`.
 *   2. Adjust the draft by hand - the common case where a commissioner drafts a
 *      schedule and the admin tweaks it:
 *        - swap or change each game's Home/Away team (`scheduleApi.editDraft`);
 *        - move a game to a different date (`scheduleApi.editDraft`);
 *        - set a venue + start time per game, or set defaults once and apply to
 *          every draft game at once (`scheduleApi.assign`).
 *   3. Regenerate to rebuild from scratch, or Submit to make the draft official
 *      and visible to Viewers (`scheduleApi.submit`).
 *
 * Draft games are hidden from the public Schedule until submitted. The whole
 * page is gated to Administrators by the route guard.
 */
import { useCallback, useMemo, useState } from 'react';
import {
  ActionIcon,
  Alert,
  Badge,
  Button,
  Card,
  Checkbox,
  Group,
  NumberInput,
  Select,
  Stack,
  Table,
  Text,
  TextInput,
  Title,
  Tooltip,
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
import { TeamSelect } from '../../components/selectors/TeamSelect.js';
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

interface GenerateValues {
  startDate: string;
  endDate: string;
  playableDays: PlayableDay[];
  roundRobinKind: 'single' | 'double';
  gamesPerDay: number | string;
}

interface DefaultValues {
  venue: string;
  startTime: string;
  durationMinutes: number | string;
}

export function SchedulePage(): JSX.Element {
  const [leagueId, setLeagueId] = useState<string | null>(null);
  const [seasonId, setSeasonId] = useState<string | null>(null);
  const [generating, setGenerating] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [busyRow, setBusyRow] = useState<string | null>(null);
  const [applyingAll, setApplyingAll] = useState(false);

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

  const defaults = useForm<DefaultValues>({
    initialValues: { venue: '', startTime: '18:00', durationMinutes: 60 },
    validate: {
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

  /** Edit a draft game's matchup/date; refreshes on success. */
  const editDraft = useCallback(
    async (
      game: GameSummary,
      patch: { date?: string; homeTeamId?: string; awayTeamId?: string },
      successMessage: string,
    ) => {
      setBusyRow(game.id);
      try {
        await scheduleApi.editDraft(game.id, patch);
        refresh();
        notifications.show({ color: 'green', title: 'Draft updated', message: successMessage });
      } catch (err: unknown) {
        notifications.show({
          color: 'red',
          title: 'Could not update the draft',
          message: messageFor(err, 'Failed to update the draft game.'),
        });
      } finally {
        setBusyRow(null);
      }
    },
    [refresh],
  );

  const swapTeams = useCallback(
    (game: GameSummary) =>
      void editDraft(
        game,
        { homeTeamId: game.awayTeamId, awayTeamId: game.homeTeamId },
        'Home and away swapped.',
      ),
    [editDraft],
  );

  const changeTeam = useCallback(
    (game: GameSummary, side: 'home' | 'away', teamId: string | null) => {
      if (teamId === null) return;
      const patch = side === 'home' ? { homeTeamId: teamId } : { awayTeamId: teamId };
      void editDraft(game, patch, 'Team changed.');
    },
    [editDraft],
  );

  const changeDate = useCallback(
    (game: GameSummary, date: string) => {
      if (date.trim() === '') return;
      void editDraft(game, { date }, 'Date updated.');
    },
    [editDraft],
  );

  /** Parse "HH:MM" to minutes from midnight, or null when malformed. */
  const parseHm = (hm: string): number | null => {
    const m = /^(\d{1,2}):(\d{2})$/.exec(hm.trim());
    if (m === null) return null;
    const h = Number(m[1]);
    const min = Number(m[2]);
    if (h < 0 || h > 23 || min < 0 || min > 59) return null;
    return h * 60 + min;
  };

  /** Format minutes-from-midnight back to "HH:MM" (24-hour). */
  const toHm = (mins: number): string => {
    const clamped = ((mins % 1440) + 1440) % 1440;
    const h = Math.floor(clamped / 60);
    const min = clamped % 60;
    return `${String(h).padStart(2, '0')}:${String(min).padStart(2, '0')}`;
  };

  /** Assign one draft game a specific start time at the default venue. */
  const assignAt = useCallback(
    async (game: GameSummary, startTime: string, silent: boolean): Promise<boolean> => {
      try {
        await scheduleApi.assign(game.id, {
          venue: defaults.values.venue.trim(),
          startTime,
          durationMinutes: Number(defaults.values.durationMinutes),
        });
        return true;
      } catch (err: unknown) {
        if (!silent) {
          notifications.show({
            color: 'red',
            title: 'Could not assign',
            message: messageFor(err, 'Failed to assign venue and time.'),
          });
        }
        return false;
      }
    },
    [defaults],
  );

  /** Validate the default venue + start time; returns the base minutes or null. */
  const validateDefaults = useCallback((): number | null => {
    const venue = defaults.values.venue.trim();
    const base = parseHm(defaults.values.startTime);
    if (venue === '') {
      defaults.setFieldError('venue', 'Enter a venue.');
      return null;
    }
    if (base === null) {
      defaults.setFieldError('startTime', 'Use HH:MM (24-hour).');
      return null;
    }
    return base;
  }, [defaults]);

  /** Apply the default venue to one game at the default start time. */
  const applyToOne = useCallback(
    async (game: GameSummary) => {
      const base = validateDefaults();
      if (base === null) return;
      setBusyRow(game.id);
      const ok = await assignAt(game, defaults.values.startTime.trim(), false);
      setBusyRow(null);
      if (ok) {
        refresh();
        notifications.show({ color: 'green', title: 'Assigned', message: 'Venue and time set.' });
      }
    },
    [validateDefaults, assignAt, defaults, refresh],
  );

  /**
   * Apply the default venue to every draft game, staggering start times per
   * date: the first game on a date starts at the default time, each later game
   * on the same date starts one duration after the previous (so 2+ games per
   * day at one venue run back-to-back instead of conflicting).
   */
  const applyToAll = useCallback(async () => {
    const base = validateDefaults();
    if (base === null) return;
    const duration = Number(defaults.values.durationMinutes);
    setApplyingAll(true);

    // Group draft games by calendar date (YYYY-MM-DD), preserving list order.
    const byDate = new Map<string, GameSummary[]>();
    for (const game of draftGames) {
      const day = game.date.slice(0, 10);
      const bucket = byDate.get(day);
      if (bucket) bucket.push(game);
      else byDate.set(day, [game]);
    }

    let ok = 0;
    let failed = 0;
    for (const bucket of byDate.values()) {
      // Sequential within a date so each slot is base + n*duration.
      for (let i = 0; i < bucket.length; i += 1) {
        const slot = toHm(base + i * duration);
        const success = await assignAt(bucket[i]!, slot, true);
        if (success) ok += 1;
        else failed += 1;
      }
    }

    refresh();
    setApplyingAll(false);
    notifications.show({
      color: failed === 0 ? 'green' : 'yellow',
      title: 'Defaults applied',
      message:
        failed === 0
          ? `Set venue and staggered times on ${ok} game(s).`
          : `Set ${ok} game(s); ${failed} could not be set (venue/time conflicts) - adjust those individually.`,
    });
  }, [validateDefaults, defaults, draftGames, assignAt, refresh]);

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

            {draftGames.length > 0 ? (
              <Card withBorder radius="md" padding="lg" maw={520}>
                <Stack gap="sm">
                  <Title order={3}>Default venue &amp; time</Title>
                  <Text size="sm" c="dimmed">
                    Set these once, then apply to every draft game. Games on the
                    same date are staggered: the first starts at the start time and
                    each later game that day begins one duration after the previous.
                  </Text>
                  <TextInput label="Venue" {...defaults.getInputProps('venue')} />
                  <Group grow>
                    <TextInput label="Start time (HH:MM)" placeholder="18:00" {...defaults.getInputProps('startTime')} />
                    <NumberInput label="Duration (minutes)" min={1} max={480} allowDecimal={false} {...defaults.getInputProps('durationMinutes')} />
                  </Group>
                  <Group>
                    <Button variant="light" onClick={() => void applyToAll()} loading={applyingAll}>
                      Apply to all draft games
                    </Button>
                  </Group>
                </Stack>
              </Card>
            ) : null}

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
                    <Table.ScrollContainer minWidth={900}>
                      <Table verticalSpacing="xs">
                        <Table.Thead>
                          <Table.Tr>
                            <Table.Th>Date</Table.Th>
                            <Table.Th>Home</Table.Th>
                            <Table.Th>Swap</Table.Th>
                            <Table.Th>Away</Table.Th>
                            <Table.Th>Venue / time</Table.Th>
                            <Table.Th>Actions</Table.Th>
                          </Table.Tr>
                        </Table.Thead>
                        <Table.Tbody>
                          {draftGames.map((game) => {
                            const rowBusy = busyRow === game.id;
                            return (
                              <Table.Tr key={game.id}>
                                <Table.Td>
                                  <TextInput
                                    type="date"
                                    size="xs"
                                    aria-label="Game date"
                                    defaultValue={game.date.slice(0, 10)}
                                    onBlur={(e) => {
                                      const v = e.currentTarget.value;
                                      if (v && v !== game.date.slice(0, 10)) changeDate(game, v);
                                    }}
                                    disabled={rowBusy}
                                  />
                                </Table.Td>
                                <Table.Td miw={160}>
                                  <TeamSelect
                                    seasonId={seasonId}
                                    value={game.homeTeamId}
                                    onChange={(id) => changeTeam(game, 'home', id)}
                                    label=""
                                    disabled={rowBusy}
                                  />
                                </Table.Td>
                                <Table.Td>
                                  <Tooltip label="Swap home and away">
                                    <ActionIcon
                                      variant="light"
                                      aria-label="Swap home and away"
                                      onClick={() => swapTeams(game)}
                                      disabled={rowBusy}
                                    >
                                      <span aria-hidden="true">&#8646;</span>
                                    </ActionIcon>
                                  </Tooltip>
                                </Table.Td>
                                <Table.Td miw={160}>
                                  <TeamSelect
                                    seasonId={seasonId}
                                    value={game.awayTeamId}
                                    onChange={(id) => changeTeam(game, 'away', id)}
                                    label=""
                                    disabled={rowBusy}
                                  />
                                </Table.Td>
                                <Table.Td>
                                  {game.venue && game.startTime
                                    ? `${game.venue} @ ${game.startTime}`
                                    : <Text c="dimmed" size="sm">unassigned</Text>}
                                </Table.Td>
                                <Table.Td>
                                  <Button
                                    size="xs"
                                    variant="light"
                                    onClick={() => void applyToOne(game)}
                                    loading={rowBusy}
                                  >
                                    Apply default
                                  </Button>
                                </Table.Td>
                              </Table.Tr>
                            );
                          })}
                        </Table.Tbody>
                      </Table>
                    </Table.ScrollContainer>
                  </Card>
                ) : null}
                <Text size="xs" c="dimmed">
                  Draft games are hidden from the public schedule until you submit.
                </Text>
              </Stack>
            </section>
          </>
        ) : (
          <Text role="status" c="dimmed">Select a league and a season to generate a schedule.</Text>
        )}
      </Stack>
    </section>
  );

  function handleSubmit(): void {
    if (seasonId === null) return;
    setSubmitting(true);
    scheduleApi
      .submit(seasonId)
      .then((res) => {
        refresh();
        notifications.show({
          color: 'green',
          title: 'Schedule submitted',
          message: `${res.games.length} game(s) are now official.`,
        });
      })
      .catch((err: unknown) => {
        notifications.show({
          color: 'red',
          title: 'Could not submit',
          message: messageFor(err, 'Failed to submit the schedule.'),
        });
      })
      .finally(() => setSubmitting(false));
  }
}