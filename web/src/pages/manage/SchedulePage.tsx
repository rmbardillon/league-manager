/**
 * Schedule management page (Manage > Schedule) - Requirement 12 + manual edits.
 *
 * Picking a League + Season loads the Season''s FULL schedule - both the draft
 * (not-yet-submitted) games and the submitted (official) games - and makes them
 * editable in place:
 *   - Draft games: generate/regenerate a round-robin draft, set a default venue
 *     and staggered times, edit each game''s date / home / away, and submit.
 *   - Submitted (official) games: still editable - change date, swap/change the
 *     teams, and set venue/time - as long as the game has not been played.
 *     Completed and cancelled games are read-only here (correct a completed
 *     game''s score on the Games page instead).
 *
 * Editing date/teams uses the general game-edit endpoint (works for draft and
 * official-but-scheduled games). Venue/time uses the draft-assign endpoint for
 * draft games and the reschedule endpoint for official games. The whole page is
 * gated to Administrators by the route guard.
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
  Modal,
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

function parseHm(hm: string): number | null {
  const m = /^(\d{1,2}):(\d{2})$/.exec(hm.trim());
  if (m === null) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (h < 0 || h > 23 || min < 0 || min > 59) return null;
  return h * 60 + min;
}

function toHm(mins: number): string {
  const clamped = ((mins % 1440) + 1440) % 1440;
  const h = Math.floor(clamped / 60);
  const min = clamped % 60;
  return `${String(h).padStart(2, '0')}:${String(min).padStart(2, '0')}`;
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

interface VenueTimeValues {
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
  const [venueTarget, setVenueTarget] = useState<GameSummary | null>(null);

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
  const officialGames = useMemo(
    () => items.filter((g) => g.scheduleState === 'official'),
    [items],
  );

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

  const venueForm = useForm<VenueTimeValues>({
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

  /** Edit a game's matchup/date (works for draft and official-scheduled). */
  const editGame = useCallback(
    async (
      game: GameSummary,
      patch: { date?: string; homeTeamId?: string; awayTeamId?: string },
      successMessage: string,
    ) => {
      setBusyRow(game.id);
      try {
        await scheduleApi.editDraft(game.id, patch);
        refresh();
        notifications.show({ color: 'green', title: 'Schedule updated', message: successMessage });
      } catch (err: unknown) {
        notifications.show({
          color: 'red',
          title: 'Could not update the game',
          message: messageFor(err, 'Failed to update the game.'),
        });
      } finally {
        setBusyRow(null);
      }
    },
    [refresh],
  );

  const swapTeams = useCallback(
    (game: GameSummary) =>
      void editGame(
        game,
        { homeTeamId: game.awayTeamId, awayTeamId: game.homeTeamId },
        'Home and away swapped.',
      ),
    [editGame],
  );

  const changeTeam = useCallback(
    (game: GameSummary, side: 'home' | 'away', teamId: string | null) => {
      if (teamId === null) return;
      const patch = side === 'home' ? { homeTeamId: teamId } : { awayTeamId: teamId };
      void editGame(game, patch, 'Team changed.');
    },
    [editGame],
  );

  const changeDate = useCallback(
    (game: GameSummary, date: string) => {
      if (date.trim() === '') return;
      void editGame(game, { date }, 'Date updated.');
    },
    [editGame],
  );

  /** Assign/update venue+time, routing to the right endpoint per state. */
  const saveVenueTime = useCallback(
    async (game: GameSummary, v: VenueTimeValues, silent: boolean): Promise<boolean> => {
      const venue = v.venue.trim();
      const startTime = v.startTime.trim();
      const durationMinutes = Number(v.durationMinutes);
      try {
        if (game.scheduleState === 'draft') {
          await scheduleApi.assign(game.id, { venue, startTime, durationMinutes });
        } else {
          // Official game: reschedule carries date + venue + time together.
          await gamesApi.reschedule(game.id, {
            date: game.date.slice(0, 10),
            startTime,
            durationMinutes,
            venue,
          });
        }
        return true;
      } catch (err: unknown) {
        if (!silent) {
          notifications.show({
            color: 'red',
            title: 'Could not set venue and time',
            message: messageFor(err, 'Failed to set venue and time.'),
          });
        }
        return false;
      }
    },
    [],
  );

  const openVenue = useCallback(
    (game: GameSummary) => {
      setVenueTarget(game);
      venueForm.setValues({
        venue: game.venue ?? defaults.values.venue,
        startTime: game.startTime ?? defaults.values.startTime,
        durationMinutes: game.durationMinutes ?? defaults.values.durationMinutes,
      });
      venueForm.clearErrors();
    },
    [venueForm, defaults.values],
  );

  const closeVenue = useCallback(() => {
    setVenueTarget(null);
    venueForm.reset();
  }, [venueForm]);

  const handleVenueSave = venueForm.onSubmit(async (values) => {
    if (venueTarget === null) return;
    setBusyRow(venueTarget.id);
    const ok = await saveVenueTime(venueTarget, values, false);
    setBusyRow(null);
    if (ok) {
      refresh();
      closeVenue();
      notifications.show({ color: 'green', title: 'Saved', message: 'Venue and time set.' });
    }
  });

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

  /**
   * Apply the default venue to every DRAFT game, staggering start times per
   * date: the first game on a date starts at the default time; each later game
   * that day starts one duration after the previous (so 2+ games per day at one
   * venue run back-to-back instead of conflicting).
   */
  const applyToAll = useCallback(async () => {
    const base = validateDefaults();
    if (base === null) return;
    const duration = Number(defaults.values.durationMinutes);
    const venue = defaults.values.venue.trim();
    setApplyingAll(true);

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
      for (let i = 0; i < bucket.length; i += 1) {
        const slot = toHm(base + i * duration);
        const success = await saveVenueTime(
          bucket[i]!,
          { venue, startTime: slot, durationMinutes: duration },
          true,
        );
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
  }, [validateDefaults, defaults, draftGames, saveVenueTime, refresh]);

  const unassignedDrafts = draftGames.filter((g) => g.venue === null || g.startTime === null).length;
  const hasSeason = seasonId !== null;

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

  /** Render an editable games table for a set of games (draft or official). */
  function renderEditableTable(rows: GameSummary[]): JSX.Element {
    return (
      <Card withBorder radius="md" padding={0}>
        <Table.ScrollContainer minWidth={940}>
          <Table verticalSpacing="xs">
            <Table.Thead>
              <Table.Tr>
                <Table.Th>Date</Table.Th>
                <Table.Th>Home</Table.Th>
                <Table.Th>Swap</Table.Th>
                <Table.Th>Away</Table.Th>
                <Table.Th>Venue / time</Table.Th>
                <Table.Th>Status</Table.Th>
                <Table.Th>Actions</Table.Th>
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {rows.map((game) => {
                const rowBusy = busyRow === game.id;
                const locked = game.status === 'completed' || game.status === 'cancelled';
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
                        disabled={rowBusy || locked}
                      />
                    </Table.Td>
                    <Table.Td miw={160}>
                      <TeamSelect
                        seasonId={seasonId}
                        value={game.homeTeamId}
                        onChange={(id) => changeTeam(game, 'home', id)}
                        label=""
                        disabled={rowBusy || locked}
                      />
                    </Table.Td>
                    <Table.Td>
                      <Tooltip label="Swap home and away">
                        <ActionIcon
                          variant="light"
                          aria-label="Swap home and away"
                          onClick={() => swapTeams(game)}
                          disabled={rowBusy || locked}
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
                        disabled={rowBusy || locked}
                      />
                    </Table.Td>
                    <Table.Td>
                      {game.venue && game.startTime ? (
                        `${game.venue} @ ${game.startTime}`
                      ) : (
                        <Text c="dimmed" size="sm">unassigned</Text>
                      )}
                    </Table.Td>
                    <Table.Td>
                      <Badge
                        variant="light"
                        radius="sm"
                        color={
                          game.status === 'completed'
                            ? 'green'
                            : game.status === 'cancelled'
                              ? 'gray'
                              : 'nba-blue'
                        }
                      >
                        {game.status}
                      </Badge>
                    </Table.Td>
                    <Table.Td>
                      <Button
                        size="xs"
                        variant="light"
                        onClick={() => openVenue(game)}
                        disabled={rowBusy || locked}
                      >
                        Venue/time
                      </Button>
                    </Table.Td>
                  </Table.Tr>
                );
              })}
            </Table.Tbody>
          </Table>
        </Table.ScrollContainer>
      </Card>
    );
  }

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
            {error !== null ? (
              <Alert role="alert" color="nba-red" title="Failed to load schedule">
                <Stack gap="xs" align="flex-start">
                  <Text size="sm">{error}</Text>
                  <Button size="xs" variant="light" onClick={reload}>Retry</Button>
                </Stack>
              </Alert>
            ) : null}
            {loading ? <Text role="status">Loading schedule...</Text> : null}

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
                  <Title order={3}>Default venue &amp; time (drafts)</Title>
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

            {draftGames.length > 0 ? (
              <section aria-labelledby="draft-list-heading">
                <Stack gap="sm">
                  <Group justify="space-between" align="flex-end">
                    <Title id="draft-list-heading" order={3}>Draft games (not submitted)</Title>
                    <Button
                      onClick={handleSubmit}
                      loading={submitting}
                      disabled={unassignedDrafts > 0}
                    >
                      Submit schedule
                    </Button>
                  </Group>
                  {unassignedDrafts > 0 ? (
                    <Text size="sm" c="dimmed">
                      Assign a venue and start time to all {unassignedDrafts} unassigned draft
                      game(s) before submitting.
                    </Text>
                  ) : null}
                  {renderEditableTable(draftGames)}
                </Stack>
              </section>
            ) : null}

            <section aria-labelledby="official-list-heading">
              <Stack gap="sm">
                <Title id="official-list-heading" order={3}>Submitted schedule (official)</Title>
                {officialGames.length === 0 ? (
                  <Text role="status" c="dimmed">
                    No official games yet. Generate a draft above and submit it.
                  </Text>
                ) : (
                  <>
                    <Text size="sm" c="dimmed">
                      These games are visible to the public. You can still change the
                      date, teams, and venue/time of a game that has not been played.
                      Completed and cancelled games are read-only here.
                    </Text>
                    {renderEditableTable(officialGames)}
                  </>
                )}
              </Stack>
            </section>
          </>
        ) : (
          <Text role="status" c="dimmed">Select a league and a season to view and edit its schedule.</Text>
        )}
      </Stack>

      {/* Venue/time modal (routes to assign for drafts, reschedule for official). */}
      <Modal opened={venueTarget !== null} onClose={closeVenue} title="Set venue and time">
        <form onSubmit={handleVenueSave} noValidate>
          <Stack gap="sm">
            <Text size="sm" c="dimmed">
              {venueTarget ? `${venueTarget.homeTeamName} vs ${venueTarget.awayTeamName}` : ''}
            </Text>
            <TextInput label="Venue" required data-autofocus {...venueForm.getInputProps('venue')} />
            <TextInput label="Start time (HH:MM)" placeholder="18:00" required {...venueForm.getInputProps('startTime')} />
            <NumberInput label="Duration (minutes)" min={1} max={480} allowDecimal={false} {...venueForm.getInputProps('durationMinutes')} />
            <Group justify="flex-end">
              <Button variant="default" type="button" onClick={closeVenue}>Cancel</Button>
              <Button type="submit" loading={venueTarget !== null && busyRow === venueTarget.id}>Save</Button>
            </Group>
          </Stack>
        </form>
      </Modal>
    </section>
  );
}