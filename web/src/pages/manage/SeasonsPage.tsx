/**
 * Season management view (Req 4.1–4.8, 10.4–10.5).
 *
 * An Administrator picks a League through a named selector (Req 4.1, 3.x) and
 * sees that League's real list of Seasons loaded from
 * `GET /leagues/:leagueId/seasons`. Because the list is API-backed it survives
 * a page refresh — nothing is tracked in session-only React state.
 *
 * From the view the Administrator can:
 *   - create a Season (name 1–100, a start date, and an end date strictly after
 *     the start date, Req 4.2, 4.3, 4.4) via `seasonsApi.create`;
 *   - close an open Season through a Mantine confirm modal (Req 4.5) via
 *     `seasonsApi.close`; a closed Season shows the close action as unavailable
 *     (Req 4.6).
 *
 * After each successful mutation the list cache key is invalidated and the list
 * refetched so the table reflects the change (Req 4.2, 4.5). Success and
 * failure are surfaced through Mantine notifications (Req 10.5, 4.8).
 * Server-side validation / conflict errors that name a field (`details.field`)
 * are shown inline on the create form; all other failures become error
 * notifications (Req 4.4, 4.8). An empty League shows an accessible empty state
 * inviting the first Season (Req 4.7).
 *
 * Date inputs use a native `TextInput type="date"` (ISO YYYY-MM-DD strings,
 * matching `CreateSeasonRequest`'s string dates) — `@mantine/dates` is not a
 * dependency, so no new dependency is introduced.
 *
 * The whole page is gated to Administrators by the route guard (task 15.1).
 */
import { useCallback, useMemo, useState } from 'react';
import {
  Alert,
  Button,
  Group,
  Modal,
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
  leaguesApi,
  seasonsApi,
  type SeasonSummary,
} from '../../api/index.js';
import { invalidate } from '../../api/resourceCache.js';
import { useResourceList } from '../../hooks/useResourceList.js';
import { LeagueSelect } from '../../components/selectors/LeagueSelect.js';

/** Client-side name bound for the create form (Req 4.2, 4.4). */
function validateName(value: string): string | null {
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    return 'Enter a season name.';
  }
  if (trimmed.length > 100) {
    return 'Season name must be at most 100 characters.';
  }
  return null;
}

/** Require a date value (Req 4.2). */
function validateDate(value: string): string | null {
  return value.trim().length === 0 ? 'Select a date.' : null;
}

/**
 * If an {@link ApiError} carries a `details.field` string, return it so the
 * caller can route the message to that form field (Req 4.4). Otherwise `null`.
 */
function fieldFromError(error: unknown): string | null {
  if (
    error instanceof ApiError &&
    typeof error.details === 'object' &&
    error.details !== null &&
    'field' in error.details &&
    typeof (error.details as { field: unknown }).field === 'string'
  ) {
    return (error.details as { field: string }).field;
  }
  return null;
}

/** The message to show for a failed mutation (server message when available). */
function messageFor(error: unknown, fallback: string): string {
  return error instanceof ApiError ? error.message : fallback;
}

interface CreateFormValues {
  name: string;
  startDate: string;
  endDate: string;
}

export function SeasonsPage(): JSX.Element {
  const [leagueId, setLeagueId] = useState<string | null>(null);

  // The Season being closed, driving the confirm modal.
  const [closeTarget, setCloseTarget] = useState<SeasonSummary | null>(null);
  const [closing, setClosing] = useState(false);
  const [closeError, setCloseError] = useState<string | null>(null);

  const listKey = leagueId !== null ? `/leagues/${leagueId}/seasons` : null;
  const seasonsLoader = useCallback(
    (signal: AbortSignal) => leaguesApi.seasons(leagueId as string, signal),
    [leagueId],
  );

  const { items, loading, error, reload } = useResourceList<SeasonSummary>(
    seasonsLoader,
    listKey,
  );

  const createForm = useForm<CreateFormValues>({
    initialValues: { name: '', startDate: '', endDate: '' },
    validate: {
      name: validateName,
      startDate: validateDate,
      // The end date must be present and strictly after the start date
      // (Req 4.3). The cross-field check runs client-side before submit.
      endDate: (value, values) => {
        const dateError = validateDate(value);
        if (dateError !== null) {
          return dateError;
        }
        if (values.startDate.trim().length > 0 && value <= values.startDate) {
          return 'End date must be after the start date.';
        }
        return null;
      },
    },
  });

  /** Invalidate the current list cache key then refetch (Req 4.2, 4.5). */
  const refreshList = useCallback(() => {
    if (listKey !== null) {
      invalidate(listKey);
    }
    reload();
  }, [listKey, reload]);

  const handleCreate = createForm.onSubmit(async (values) => {
    if (leagueId === null) {
      return;
    }
    try {
      const created = await seasonsApi.create({
        leagueId,
        name: values.name.trim(),
        startDate: values.startDate,
        endDate: values.endDate,
      });
      refreshList();
      createForm.reset();
      notifications.show({
        color: 'green',
        title: 'Season created',
        message: `Created "${created.name}".`,
      });
    } catch (err: unknown) {
      // Route a server-named field error inline; otherwise notify (Req 4.4, 4.8).
      const field = fieldFromError(err);
      if (
        field === 'name' ||
        field === 'startDate' ||
        field === 'endDate'
      ) {
        createForm.setFieldError(field, messageFor(err, 'Invalid value.'));
        return;
      }
      notifications.show({
        color: 'red',
        title: 'Failed to create the Season',
        message: messageFor(err, 'Failed to create the Season.'),
      });
    }
  });

  const openClose = useCallback((season: SeasonSummary) => {
    setCloseError(null);
    setCloseTarget(season);
  }, []);

  const closeCloseModal = useCallback(() => {
    setCloseTarget(null);
    setCloseError(null);
  }, []);

  const handleClose = useCallback(async () => {
    if (closeTarget === null) {
      return;
    }
    setClosing(true);
    setCloseError(null);
    try {
      await seasonsApi.close(closeTarget.id);
      const name = closeTarget.name;
      refreshList();
      closeCloseModal();
      notifications.show({
        color: 'green',
        title: 'Season closed',
        message: `Closed "${name}".`,
      });
    } catch (err: unknown) {
      // Keep the modal open and surface the reason both inline and as a
      // notification; leave the list unchanged (Req 4.8).
      const message = messageFor(err, 'Failed to close the Season.');
      setCloseError(message);
      notifications.show({
        color: 'red',
        title: 'Failed to close the Season',
        message,
      });
    } finally {
      setClosing(false);
    }
  }, [closeTarget, refreshList, closeCloseModal]);

  const hasLeague = leagueId !== null;
  const showEmptyState = useMemo(
    () => hasLeague && !loading && error === null && items.length === 0,
    [hasLeague, loading, error, items.length],
  );

  return (
    <section aria-labelledby="seasons-heading">
      <Stack gap="lg">
        <Title id="seasons-heading" order={2}>
          Manage Seasons
        </Title>

        <Stack gap="sm" maw={420}>
          <LeagueSelect value={leagueId} onChange={setLeagueId} />
        </Stack>

        {hasLeague ? (
          <>
            <section aria-labelledby="create-season-heading">
              <Stack gap="sm" maw={420}>
                <Title id="create-season-heading" order={3}>
                  Create a Season
                </Title>
                <form onSubmit={handleCreate} noValidate>
                  <Stack gap="sm">
                    <TextInput
                      label="Season name"
                      required
                      maxLength={100}
                      {...createForm.getInputProps('name')}
                    />
                    <TextInput
                      label="Start date"
                      type="date"
                      required
                      {...createForm.getInputProps('startDate')}
                    />
                    <TextInput
                      label="End date"
                      type="date"
                      required
                      {...createForm.getInputProps('endDate')}
                    />
                    <Group>
                      <Button type="submit" loading={createForm.submitting}>
                        Create Season
                      </Button>
                    </Group>
                  </Stack>
                </form>
              </Stack>
            </section>

            <section aria-labelledby="season-list-heading">
              <Stack gap="sm">
                <Title id="season-list-heading" order={3}>
                  Seasons
                </Title>

                {error !== null ? (
                  <Alert role="alert" color="red" title="Failed to load seasons">
                    <Stack gap="xs" align="flex-start">
                      <Text size="sm">{error}</Text>
                      <Button size="xs" variant="light" onClick={reload}>
                        Retry
                      </Button>
                    </Stack>
                  </Alert>
                ) : null}

                {loading ? <Text role="status">Loading seasons…</Text> : null}

                {showEmptyState ? (
                  <Text role="status" c="dimmed">
                    No seasons in this league yet. Create the first Season above.
                  </Text>
                ) : null}

                {!loading && error === null && items.length > 0 ? (
                  <Table striped highlightOnHover>
                    <Table.Caption>Seasons in the selected league</Table.Caption>
                    <Table.Thead>
                      <Table.Tr>
                        <Table.Th scope="col">Name</Table.Th>
                        <Table.Th scope="col">Start</Table.Th>
                        <Table.Th scope="col">End</Table.Th>
                        <Table.Th scope="col">Closed</Table.Th>
                        <Table.Th scope="col">Actions</Table.Th>
                      </Table.Tr>
                    </Table.Thead>
                    <Table.Tbody>
                      {items.map((season) => (
                        <Table.Tr key={season.id}>
                          <Table.Td>{season.name}</Table.Td>
                          <Table.Td>{season.startDate}</Table.Td>
                          <Table.Td>{season.endDate}</Table.Td>
                          <Table.Td>{season.closed ? 'Yes' : 'No'}</Table.Td>
                          <Table.Td>
                            <Button
                              size="xs"
                              variant="light"
                              color="red"
                              disabled={season.closed}
                              onClick={() => openClose(season)}
                            >
                              Close
                            </Button>
                          </Table.Td>
                        </Table.Tr>
                      ))}
                    </Table.Tbody>
                  </Table>
                ) : null}
              </Stack>
            </section>
          </>
        ) : (
          <Text role="status" c="dimmed">
            Select a league to manage its seasons.
          </Text>
        )}
      </Stack>

      {/* Close confirm modal — Mantine confirm dialog (Req 4.5). */}
      <Modal
        opened={closeTarget !== null}
        onClose={closeCloseModal}
        title="Close Season"
      >
        <Stack gap="sm">
          <Text>
            Close Season &quot;{closeTarget?.name}&quot;? Closing snapshots its
            final standings and cannot be undone.
          </Text>
          {closeError !== null ? (
            <Alert role="alert" color="red" title="Could not close">
              {closeError}
            </Alert>
          ) : null}
          <Group justify="flex-end">
            <Button variant="default" onClick={closeCloseModal} type="button">
              Cancel
            </Button>
            <Button
              color="red"
              onClick={() => void handleClose()}
              loading={closing}
            >
              Close Season
            </Button>
          </Group>
        </Stack>
      </Modal>
    </section>
  );
}
