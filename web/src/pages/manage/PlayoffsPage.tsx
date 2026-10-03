/**
 * Playoff management view (Req 9.1–9.10, 10.4–10.6).
 *
 * An Administrator picks a League then a Season through named selectors
 * (Req 9.1, 3.x). Once a Season is chosen the page gates three sub-forms that
 * each resolve every choice through a Selector — there is no raw-id entry
 * anywhere (Req 9.9):
 *
 *   1. Create a Playoff_Round — a {@link PlayoffRoundTypeSelect} →
 *      `seasonsApi.createPlayoffRound` (Req 9.2).
 *   2. Create a Series — a round {@link EntitySelect} (from
 *      `seasonsApi.playoffRounds`), two {@link TeamSelect}s, and a
 *      {@link BestOfSelect} → `playoffApi.createSeries` (Req 9.4).
 *   3. Create a Playoff_Game — a round select, two {@link TeamSelect}s, a date,
 *      and an optional Series select (from `playoffApi.series`) →
 *      `seasonsApi.createPlayoffGame` (Req 9.6).
 *
 * Client validation rejects two identical Teams before submit for both the
 * Series and the Playoff_Game forms (Req 9.7). The {@link BestOfSelect} value is
 * a string id, so it is mapped to the numeric {@link BestOf} with
 * {@link parseBestOf} before calling the API. On success a notification is
 * shown and the relevant list(s) are refreshed; closed-season and any other
 * server failure surface as error notifications (Req 9.8, 9.10). The whole page
 * is gated to Administrators by the route guard.
 *
 * Note: `@mantine/dates` is not a project dependency, so the Playoff_Game date
 * uses a native `TextInput type="date"`, which yields the ISO `YYYY-MM-DD`
 * string the API expects.
 */
import { useCallback, useMemo, useState } from 'react';
import {
  Button,
  Divider,
  Group,
  Stack,
  Text,
  TextInput,
  Title,
} from '@mantine/core';
import { notifications } from '@mantine/notifications';

import {
  ApiError,
  playoffApi,
  seasonsApi,
  type PlayoffRoundSummary,
  type PlayoffRoundType,
  type SeriesSummary,
} from '../../api/index.js';
import { invalidate } from '../../api/resourceCache.js';
import { useResourceList } from '../../hooks/useResourceList.js';
import { LeagueSelect } from '../../components/selectors/LeagueSelect.js';
import { SeasonSelect } from '../../components/selectors/SeasonSelect.js';
import { TeamSelect } from '../../components/selectors/TeamSelect.js';
import {
  BestOfSelect,
  parseBestOf,
} from '../../components/selectors/BestOfSelect.js';
import { PlayoffRoundTypeSelect } from '../../components/selectors/PlayoffRoundTypeSelect.js';
import { EntitySelect } from '../../components/selectors/EntitySelect.js';

/** The message to show for a failed mutation (server message when available). */
function messageFor(error: unknown, fallback: string): string {
  return error instanceof ApiError ? error.message : fallback;
}

/** Human-readable label for a playoff round option. */
function roundLabel(round: PlayoffRoundSummary): string {
  return round.type;
}

/** Human-readable label for a series option (teams are opaque ids here). */
function seriesLabel(series: SeriesSummary): string {
  return `Best of ${series.bestOf} — ${series.teamAId} vs ${series.teamBId}`;
}

export function PlayoffsPage(): JSX.Element {
  const [leagueId, setLeagueId] = useState<string | null>(null);
  const [seasonId, setSeasonId] = useState<string | null>(null);

  // --- Round list (shared by all three sub-forms' round selects) -----------
  const roundsKey =
    seasonId !== null ? `/seasons/${seasonId}/playoff-rounds` : null;
  const roundsLoader = useCallback(
    (signal: AbortSignal) =>
      seasonsApi.playoffRounds(seasonId as string, signal),
    [seasonId],
  );
  const {
    items: rounds,
    loading: roundsLoading,
    error: roundsError,
    reload: reloadRounds,
  } = useResourceList<PlayoffRoundSummary>(roundsLoader, roundsKey);

  const refreshRounds = useCallback(() => {
    if (roundsKey !== null) {
      invalidate(roundsKey);
    }
    reloadRounds();
  }, [roundsKey, reloadRounds]);

  // --- Create Round form ---------------------------------------------------
  const [roundType, setRoundType] = useState<PlayoffRoundType | null>(null);
  const [creatingRound, setCreatingRound] = useState(false);

  const handleCreateRound = useCallback(async () => {
    if (seasonId === null || roundType === null) {
      return;
    }
    setCreatingRound(true);
    try {
      const created = await seasonsApi.createPlayoffRound(seasonId, {
        type: roundType,
      });
      refreshRounds();
      setRoundType(null);
      notifications.show({
        color: 'green',
        title: 'Playoff round created',
        message: `Created the ${created.type} round.`,
      });
    } catch (err: unknown) {
      notifications.show({
        color: 'red',
        title: 'Failed to create the playoff round',
        message: messageFor(err, 'Failed to create the playoff round.'),
      });
    } finally {
      setCreatingRound(false);
    }
  }, [seasonId, roundType, refreshRounds]);

  // --- Create Series form --------------------------------------------------
  const [seriesRoundId, setSeriesRoundId] = useState<string | null>(null);
  const [seriesTeamAId, setSeriesTeamAId] = useState<string | null>(null);
  const [seriesTeamBId, setSeriesTeamBId] = useState<string | null>(null);
  const [bestOfId, setBestOfId] = useState<string | null>(null);
  const [seriesTeamsError, setSeriesTeamsError] = useState<string | null>(null);
  const [creatingSeries, setCreatingSeries] = useState(false);

  const handleCreateSeries = useCallback(async () => {
    if (
      seriesRoundId === null ||
      seriesTeamAId === null ||
      seriesTeamBId === null
    ) {
      return;
    }
    // Reject identical teams before submit (Req 9.7).
    if (seriesTeamAId === seriesTeamBId) {
      setSeriesTeamsError('The two teams must be distinct.');
      return;
    }
    const bestOf = parseBestOf(bestOfId);
    if (bestOf === null) {
      return;
    }
    setSeriesTeamsError(null);
    setCreatingSeries(true);
    try {
      await playoffApi.createSeries(seriesRoundId, {
        teamAId: seriesTeamAId,
        teamBId: seriesTeamBId,
        bestOf,
      });
      invalidate(`/playoff-rounds/${seriesRoundId}/series`);
      setSeriesTeamAId(null);
      setSeriesTeamBId(null);
      setBestOfId(null);
      notifications.show({
        color: 'green',
        title: 'Series created',
        message: `Created a best-of-${bestOf} series.`,
      });
    } catch (err: unknown) {
      notifications.show({
        color: 'red',
        title: 'Failed to create the series',
        message: messageFor(err, 'Failed to create the series.'),
      });
    } finally {
      setCreatingSeries(false);
    }
  }, [seriesRoundId, seriesTeamAId, seriesTeamBId, bestOfId]);

  // --- Create Playoff Game form -------------------------------------------
  const [gameRoundId, setGameRoundId] = useState<string | null>(null);
  const [gameHomeTeamId, setGameHomeTeamId] = useState<string | null>(null);
  const [gameAwayTeamId, setGameAwayTeamId] = useState<string | null>(null);
  const [gameDate, setGameDate] = useState('');
  const [gameSeriesId, setGameSeriesId] = useState<string | null>(null);
  const [gameTeamsError, setGameTeamsError] = useState<string | null>(null);
  const [gameDateError, setGameDateError] = useState<string | null>(null);
  const [creatingGame, setCreatingGame] = useState(false);

  // The Series select is scoped to the round chosen for the Playoff Game.
  const gameSeriesKey =
    gameRoundId !== null ? `/playoff-rounds/${gameRoundId}/series` : null;
  const gameSeriesLoader = useCallback(
    (signal: AbortSignal) => playoffApi.series(gameRoundId as string, signal),
    [gameRoundId],
  );
  const {
    items: gameSeries,
    loading: gameSeriesLoading,
    error: gameSeriesError,
    reload: reloadGameSeries,
  } = useResourceList<SeriesSummary>(gameSeriesLoader, gameSeriesKey);

  const handleCreateGame = useCallback(async () => {
    if (
      seasonId === null ||
      gameRoundId === null ||
      gameHomeTeamId === null ||
      gameAwayTeamId === null
    ) {
      return;
    }
    let invalid = false;
    // Reject identical teams before submit (Req 9.7).
    if (gameHomeTeamId === gameAwayTeamId) {
      setGameTeamsError('The two teams must be distinct.');
      invalid = true;
    } else {
      setGameTeamsError(null);
    }
    if (gameDate.trim().length === 0) {
      setGameDateError('Enter a date for the game.');
      invalid = true;
    } else {
      setGameDateError(null);
    }
    if (invalid) {
      return;
    }
    setCreatingGame(true);
    try {
      await seasonsApi.createPlayoffGame(seasonId, {
        homeTeamId: gameHomeTeamId,
        awayTeamId: gameAwayTeamId,
        date: gameDate,
        playoffRoundId: gameRoundId,
        seriesId: gameSeriesId,
      });
      setGameHomeTeamId(null);
      setGameAwayTeamId(null);
      setGameDate('');
      setGameSeriesId(null);
      notifications.show({
        color: 'green',
        title: 'Playoff game created',
        message: 'Created the playoff game.',
      });
    } catch (err: unknown) {
      // Closed-season and any other server error surface here (Req 9.8, 9.10).
      notifications.show({
        color: 'red',
        title: 'Failed to create the playoff game',
        message: messageFor(err, 'Failed to create the playoff game.'),
      });
    } finally {
      setCreatingGame(false);
    }
  }, [
    seasonId,
    gameRoundId,
    gameHomeTeamId,
    gameAwayTeamId,
    gameDate,
    gameSeriesId,
  ]);

  const hasSeason = seasonId !== null;

  const canCreateRound = hasSeason && roundType !== null && !creatingRound;
  const canCreateSeries = useMemo(
    () =>
      seriesRoundId !== null &&
      seriesTeamAId !== null &&
      seriesTeamBId !== null &&
      bestOfId !== null &&
      !creatingSeries,
    [seriesRoundId, seriesTeamAId, seriesTeamBId, bestOfId, creatingSeries],
  );
  const canCreateGame = useMemo(
    () =>
      gameRoundId !== null &&
      gameHomeTeamId !== null &&
      gameAwayTeamId !== null &&
      gameDate.trim().length > 0 &&
      !creatingGame,
    [gameRoundId, gameHomeTeamId, gameAwayTeamId, gameDate, creatingGame],
  );

  return (
    <section aria-labelledby="playoffs-heading">
      <Stack gap="lg">
        <Title id="playoffs-heading" order={2}>
          Manage Playoffs
        </Title>

        <Stack gap="sm" maw={420}>
          <LeagueSelect
            value={leagueId}
            onChange={(id) => {
              setLeagueId(id);
              // Clearing / changing the League resets the dependent Season and
              // every per-season sub-form selection.
              setSeasonId(null);
              resetAllSubForms();
            }}
          />
          <SeasonSelect
            leagueId={leagueId}
            value={seasonId}
            onChange={(id) => {
              setSeasonId(id);
              resetAllSubForms();
            }}
          />
        </Stack>

        {hasSeason ? (
          <>
            {/* 1. Create a Playoff Round (Req 9.2). */}
            <section aria-labelledby="create-round-heading">
              <Stack gap="sm" maw={420}>
                <Title id="create-round-heading" order={3}>
                  Create a Playoff Round
                </Title>
                <PlayoffRoundTypeSelect
                  value={roundType}
                  onChange={setRoundType}
                  required
                />
                <Group>
                  <Button
                    onClick={() => void handleCreateRound()}
                    loading={creatingRound}
                    disabled={!canCreateRound}
                  >
                    Create Round
                  </Button>
                </Group>
              </Stack>
            </section>

            <Divider />

            {/* 2. Create a Series (Req 9.4, 9.7). */}
            <section aria-labelledby="create-series-heading">
              <Stack gap="sm" maw={420}>
                <Title id="create-series-heading" order={3}>
                  Create a Series
                </Title>
                <EntitySelect
                  label="Playoff round"
                  items={rounds}
                  getId={(round) => round.id}
                  getLabel={roundLabel}
                  value={seriesRoundId}
                  onChange={setSeriesRoundId}
                  loading={roundsLoading}
                  error={roundsError}
                  onRetry={reloadRounds}
                  emptyMessage="No playoff rounds yet. Create one above."
                  required
                />
                <TeamSelect
                  seasonId={seasonId}
                  value={seriesTeamAId}
                  onChange={(id) => {
                    setSeriesTeamAId(id);
                    setSeriesTeamsError(null);
                  }}
                  label="Team A"
                  required
                />
                <TeamSelect
                  seasonId={seasonId}
                  value={seriesTeamBId}
                  onChange={(id) => {
                    setSeriesTeamBId(id);
                    setSeriesTeamsError(null);
                  }}
                  label="Team B"
                  required
                />
                <BestOfSelect
                  value={bestOfId}
                  onChange={setBestOfId}
                  required
                />
                {seriesTeamsError !== null ? (
                  <Text role="alert" c="red" size="sm">
                    {seriesTeamsError}
                  </Text>
                ) : null}
                <Group>
                  <Button
                    onClick={() => void handleCreateSeries()}
                    loading={creatingSeries}
                    disabled={!canCreateSeries}
                  >
                    Create Series
                  </Button>
                </Group>
              </Stack>
            </section>

            <Divider />

            {/* 3. Create a Playoff Game (Req 9.6, 9.7, 9.8). */}
            <section aria-labelledby="create-game-heading">
              <Stack gap="sm" maw={420}>
                <Title id="create-game-heading" order={3}>
                  Create a Playoff Game
                </Title>
                <EntitySelect
                  label="Playoff round"
                  items={rounds}
                  getId={(round) => round.id}
                  getLabel={roundLabel}
                  value={gameRoundId}
                  onChange={(id) => {
                    setGameRoundId(id);
                    // The optional Series is scoped to the round, so reset it.
                    setGameSeriesId(null);
                  }}
                  loading={roundsLoading}
                  error={roundsError}
                  onRetry={reloadRounds}
                  emptyMessage="No playoff rounds yet. Create one above."
                  required
                />
                <TeamSelect
                  seasonId={seasonId}
                  value={gameHomeTeamId}
                  onChange={(id) => {
                    setGameHomeTeamId(id);
                    setGameTeamsError(null);
                  }}
                  label="Home team"
                  required
                />
                <TeamSelect
                  seasonId={seasonId}
                  value={gameAwayTeamId}
                  onChange={(id) => {
                    setGameAwayTeamId(id);
                    setGameTeamsError(null);
                  }}
                  label="Away team"
                  required
                />
                <TextInput
                  label="Date"
                  type="date"
                  required
                  value={gameDate}
                  onChange={(event) => {
                    setGameDate(event.currentTarget.value);
                    setGameDateError(null);
                  }}
                  error={gameDateError}
                />
                {gameRoundId !== null ? (
                  <EntitySelect
                    label="Series (optional)"
                    items={gameSeries}
                    getId={(series) => series.id}
                    getLabel={seriesLabel}
                    value={gameSeriesId}
                    onChange={setGameSeriesId}
                    loading={gameSeriesLoading}
                    error={gameSeriesError}
                    onRetry={reloadGameSeries}
                    emptyMessage="No series in this round. A series is optional."
                    placeholder="No series"
                  />
                ) : null}
                {gameTeamsError !== null ? (
                  <Text role="alert" c="red" size="sm">
                    {gameTeamsError}
                  </Text>
                ) : null}
                <Group>
                  <Button
                    onClick={() => void handleCreateGame()}
                    loading={creatingGame}
                    disabled={!canCreateGame}
                  >
                    Create Playoff Game
                  </Button>
                </Group>
              </Stack>
            </section>
          </>
        ) : (
          <Text role="status" c="dimmed">
            Select a league and a season to manage its playoffs.
          </Text>
        )}
      </Stack>
    </section>
  );

  /** Clear every per-season sub-form selection when the Season changes. */
  function resetAllSubForms(): void {
    setRoundType(null);
    setSeriesRoundId(null);
    setSeriesTeamAId(null);
    setSeriesTeamBId(null);
    setBestOfId(null);
    setSeriesTeamsError(null);
    setGameRoundId(null);
    setGameHomeTeamId(null);
    setGameAwayTeamId(null);
    setGameDate('');
    setGameSeriesId(null);
    setGameTeamsError(null);
    setGameDateError(null);
  }
}
