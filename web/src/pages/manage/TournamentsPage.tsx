/**
 * Tournament management view (Req 8.1–8.6).
 *
 * An Administrator chooses a League then a Season through named Selectors
 * (never a raw identifier — Req 3.1, 11.5): `LeagueSelect` → `SeasonSelect`.
 * Once a Season is chosen, its Tournaments are loaded from
 * `seasonsApi.tournaments(seasonId)` and rendered in a Mantine `Table` showing
 * each Tournament's format and, where applicable, its round-robin kind
 * (Req 8.1). An empty Season shows an accessible empty state inviting the first
 * Tournament (Req 8.5).
 *
 * The create form offers only valid formats via `TournamentFormatSelect`
 * (Req 8.2). When the chosen format is `round-robin`, `RoundRobinKindSelect`
 * becomes required and is validated before submission (Req 8.3). On success the
 * list refreshes and a success notification is shown (Req 8.2); on failure an
 * accessible error notification conveys the envelope's message and the list is
 * left unchanged (Req 8.6). Field-scoped server errors (`ValidationError` /
 * `ConflictError` with `details.field`) surface inline on the form.
 *
 * The whole page is gated to Administrators by the route guard.
 */
import { useCallback, useState } from 'react';
import { Button, Group, Stack, Table, Text, Title } from '@mantine/core';
import { useForm } from '@mantine/form';
import { notifications } from '@mantine/notifications';

import {
  ApiError,
  seasonsApi,
  type RoundRobinKind,
  type TournamentFormat,
  type TournamentSummary,
} from '../../api/index.js';
import { useResourceList } from '../../hooks/useResourceList.js';
import { LeagueSelect } from '../../components/selectors/LeagueSelect.js';
import { SeasonSelect } from '../../components/selectors/SeasonSelect.js';
import { TournamentFormatSelect } from '../../components/selectors/TournamentFormatSelect.js';
import { RoundRobinKindSelect } from '../../components/selectors/RoundRobinKindSelect.js';

interface CreateTournamentValues {
  format: TournamentFormat | null;
  roundRobinKind: RoundRobinKind | null;
}

/** Human-readable labels for the closed set of Tournament formats. */
const FORMAT_LABELS: Record<TournamentFormat, string> = {
  'single-elimination': 'Single Elimination',
  'double-elimination': 'Double Elimination',
  'round-robin': 'Round Robin',
};

/** Human-readable labels for the round-robin kinds. */
const KIND_LABELS: Record<RoundRobinKind, string> = {
  single: 'Single',
  double: 'Double',
};

/** Field names the server may scope a validation/conflict error to. */
const FORM_FIELDS = ['format', 'roundRobinKind'] as const;

/** Extract a `details.field` from an {@link ApiError} if it names a form field. */
function fieldFromError(err: ApiError): keyof CreateTournamentValues | null {
  const details = err.details;
  if (typeof details === 'object' && details !== null && 'field' in details) {
    const field = (details as { field: unknown }).field;
    if (typeof field === 'string' && (FORM_FIELDS as readonly string[]).includes(field)) {
      return field as keyof CreateTournamentValues;
    }
  }
  return null;
}

export function TournamentsPage(): JSX.Element {
  const [leagueId, setLeagueId] = useState<string | null>(null);
  const [seasonId, setSeasonId] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const loader = useCallback(
    (signal: AbortSignal) => seasonsApi.tournaments(seasonId as string, signal),
    [seasonId],
  );
  const listKey = seasonId !== null ? `/seasons/${seasonId}/tournaments` : null;
  const { items, loading, error, reload } = useResourceList<TournamentSummary>(
    loader,
    listKey,
  );

  const form = useForm<CreateTournamentValues>({
    initialValues: { format: null, roundRobinKind: null },
    validate: {
      format: (value) => (value === null ? 'Select a format.' : null),
      // The round-robin kind is required only when the chosen format is
      // round-robin, and must be cleared otherwise (Req 8.3).
      roundRobinKind: (value, values) =>
        values.format === 'round-robin' && value === null
          ? 'Select a round-robin kind.'
          : null,
    },
  });

  // When the League changes, reset the dependent Season so a stale season id
  // never drives the Tournament list.
  const handleLeagueChange = (id: string | null): void => {
    setLeagueId(id);
    setSeasonId(null);
  };

  // Choosing a different format clears a now-irrelevant kind selection so a
  // non-round-robin Tournament never carries a round-robin kind.
  const handleFormatChange = (next: TournamentFormat | null): void => {
    form.setFieldValue('format', next);
    if (next !== 'round-robin') {
      form.setFieldValue('roundRobinKind', null);
    }
  };

  const handleSubmit = async (values: CreateTournamentValues): Promise<void> => {
    if (seasonId === null || values.format === null) {
      return;
    }
    setSubmitting(true);
    try {
      await seasonsApi.createTournament(seasonId, {
        format: values.format,
        ...(values.format === 'round-robin' && values.roundRobinKind !== null
          ? { roundRobinKind: values.roundRobinKind }
          : {}),
      });
      notifications.show({
        color: 'green',
        title: 'Tournament created',
        message: `Created a ${FORMAT_LABELS[values.format]} tournament.`,
      });
      form.reset();
      reload();
    } catch (err: unknown) {
      if (err instanceof ApiError) {
        const field = fieldFromError(err);
        if (field !== null) {
          form.setFieldError(field, err.message);
        } else {
          // Operation-level failure: notify and leave the list unchanged (Req 8.6).
          notifications.show({
            color: 'red',
            title: 'Could not create the tournament',
            message: err.message,
          });
        }
      } else {
        notifications.show({
          color: 'red',
          title: 'Could not create the tournament',
          message: 'Failed to create the tournament.',
        });
      }
    } finally {
      setSubmitting(false);
    }
  };

  const isRoundRobin = form.values.format === 'round-robin';

  return (
    <section aria-labelledby="tournaments-heading">
      <Stack gap="lg">
        <Title order={2} id="tournaments-heading">
          Manage Tournaments
        </Title>

        <Stack gap="sm">
          <LeagueSelect value={leagueId} onChange={handleLeagueChange} />
          <SeasonSelect
            leagueId={leagueId}
            value={seasonId}
            onChange={setSeasonId}
          />
        </Stack>

        {seasonId !== null && (
          <>
            <form onSubmit={form.onSubmit(handleSubmit)} noValidate>
              <Stack gap="sm">
              <Title order={3}>Create a Tournament</Title>
              <Stack gap={4}>
                <TournamentFormatSelect
                  value={form.values.format}
                  onChange={handleFormatChange}
                  required
                />
                {form.errors.format ? (
                  <Text role="alert" c="red" size="sm">
                    {form.errors.format}
                  </Text>
                ) : null}
              </Stack>
              {isRoundRobin && (
                <Stack gap={4}>
                  <RoundRobinKindSelect
                    value={form.values.roundRobinKind}
                    onChange={(next) => form.setFieldValue('roundRobinKind', next)}
                    required
                  />
                  {form.errors.roundRobinKind ? (
                    <Text role="alert" c="red" size="sm">
                      {form.errors.roundRobinKind}
                    </Text>
                  ) : null}
                </Stack>
              )}
              <Group>
                <Button type="submit" loading={submitting}>
                  Create Tournament
                </Button>
              </Group>
              </Stack>
            </form>

            <Stack gap="sm">
              <Title order={3}>Tournaments</Title>
              {loading ? (
                <Text role="status">Loading tournaments…</Text>
              ) : error !== null ? (
                <Stack gap="xs" align="flex-start">
                  <Text role="alert" c="red">
                    {error}
                  </Text>
                  <Button size="xs" variant="light" onClick={reload}>
                    Retry
                  </Button>
                </Stack>
              ) : items.length === 0 ? (
                <Text role="status" c="dimmed">
                  No tournaments yet for this season. Create the first one above.
                </Text>
              ) : (
                <Table striped highlightOnHover>
                  <Table.Thead>
                    <Table.Tr>
                      <Table.Th>Format</Table.Th>
                      <Table.Th>Round-robin kind</Table.Th>
                    </Table.Tr>
                  </Table.Thead>
                  <Table.Tbody>
                    {items.map((tournament) => (
                      <Table.Tr key={tournament.id}>
                        <Table.Td>{FORMAT_LABELS[tournament.format]}</Table.Td>
                        <Table.Td>
                          {tournament.roundRobinKind
                            ? KIND_LABELS[tournament.roundRobinKind]
                            : '—'}
                        </Table.Td>
                      </Table.Tr>
                    ))}
                  </Table.Tbody>
                </Table>
              )}
            </Stack>
          </>
        )}
      </Stack>
    </section>
  );
}
