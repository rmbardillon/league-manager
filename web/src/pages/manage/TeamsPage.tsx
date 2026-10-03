/**
 * Team management view (Req 5.1–5.8, 10.4–10.6).
 *
 * An Administrator picks a League then a Season through named selectors
 * (Req 5.1, 3.x) and sees that Season's real list of Teams loaded from
 * `GET /seasons/:seasonId/teams`. Because the list is API-backed it survives a
 * page refresh (Req 5.1, 5.2) — nothing is tracked in session-only React state.
 *
 * From the list the Administrator can:
 *   - create a Team (name 1–100, Req 5.3, 5.4);
 *   - rename a Team through a Mantine modal form, replacing `window.prompt`
 *     (Req 5.5, 10.6);
 *   - delete a Team through a Mantine confirm modal, replacing `window.confirm`
 *     (Req 5.6, 5.7, 10.6).
 *
 * After each successful mutation the list cache key is invalidated and the list
 * refetched so the table reflects the change (Req 5.3, 5.5, 5.6). Success and
 * failure are surfaced through Mantine notifications (Req 10.5). Server-side
 * validation / conflict errors that name a field (`details.field`) are shown
 * inline on the relevant form; all other failures become error notifications
 * (Req 5.4, 10.4). An empty Season shows an accessible empty state inviting the
 * first Team (Req 5.8).
 *
 * The whole page is gated to Administrators by the route guard.
 */
import { useCallback, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
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
  seasonsApi,
  teamsApi,
  type TeamSummary,
} from '../../api/index.js';
import { invalidate } from '../../api/resourceCache.js';
import { useResourceList } from '../../hooks/useResourceList.js';
import { LeagueSelect } from '../../components/selectors/LeagueSelect.js';
import { SeasonSelect } from '../../components/selectors/SeasonSelect.js';

/** Client-side name bound shared by the create and rename forms (Req 5.3, 5.5). */
function validateName(value: string): string | null {
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    return 'Enter a team name.';
  }
  if (trimmed.length > 100) {
    return 'Team name must be at most 100 characters.';
  }
  return null;
}

/**
 * If an {@link ApiError} carries a `details.field` string, return it so the
 * caller can route the message to that form field (Req 5.4). Otherwise `null`.
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
}

interface RenameFormValues {
  name: string;
}

export function TeamsPage(): JSX.Element {
  const [leagueId, setLeagueId] = useState<string | null>(null);
  const [seasonId, setSeasonId] = useState<string | null>(null);

  // The Team being renamed / deleted, driving the respective modals.
  const [renameTarget, setRenameTarget] = useState<TeamSummary | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<TeamSummary | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const listKey = seasonId !== null ? `/seasons/${seasonId}/teams` : null;
  const teamsLoader = useCallback(
    (signal: AbortSignal) => seasonsApi.teams(seasonId as string, signal),
    [seasonId],
  );

  const { items, loading, error, reload } = useResourceList<TeamSummary>(
    teamsLoader,
    listKey,
  );

  const createForm = useForm<CreateFormValues>({
    initialValues: { name: '' },
    validate: { name: validateName },
  });

  const renameForm = useForm<RenameFormValues>({
    initialValues: { name: '' },
    validate: { name: validateName },
  });

  /** Invalidate the current list cache key then refetch (Req 5.3, 5.5, 5.6). */
  const refreshList = useCallback(() => {
    if (listKey !== null) {
      invalidate(listKey);
    }
    reload();
  }, [listKey, reload]);

  const handleCreate = createForm.onSubmit(async (values) => {
    if (seasonId === null) {
      return;
    }
    try {
      const created = await teamsApi.create({
        seasonId,
        name: values.name.trim(),
      });
      refreshList();
      createForm.reset();
      notifications.show({
        color: 'green',
        title: 'Team created',
        message: `Created "${created.name}".`,
      });
    } catch (err: unknown) {
      const field = fieldFromError(err);
      if (field === 'name') {
        createForm.setFieldError('name', messageFor(err, 'Invalid team name.'));
        return;
      }
      notifications.show({
        color: 'red',
        title: 'Failed to create the Team',
        message: messageFor(err, 'Failed to create the Team.'),
      });
    }
  });

  const openRename = useCallback(
    (team: TeamSummary) => {
      setRenameTarget(team);
      renameForm.setValues({ name: team.name });
      renameForm.clearErrors();
    },
    [renameForm],
  );

  const closeRename = useCallback(() => {
    setRenameTarget(null);
    renameForm.reset();
  }, [renameForm]);

  const handleRename = renameForm.onSubmit(async (values) => {
    if (renameTarget === null) {
      return;
    }
    try {
      const updated = await teamsApi.update(renameTarget.id, {
        name: values.name.trim(),
      });
      refreshList();
      closeRename();
      notifications.show({
        color: 'green',
        title: 'Team renamed',
        message: `Renamed to "${updated.name}".`,
      });
    } catch (err: unknown) {
      const field = fieldFromError(err);
      if (field === 'name') {
        renameForm.setFieldError('name', messageFor(err, 'Invalid team name.'));
        return;
      }
      notifications.show({
        color: 'red',
        title: 'Failed to rename the Team',
        message: messageFor(err, 'Failed to rename the Team.'),
      });
    }
  });

  const openDelete = useCallback((team: TeamSummary) => {
    setDeleteError(null);
    setDeleteTarget(team);
  }, []);

  const closeDelete = useCallback(() => {
    setDeleteTarget(null);
    setDeleteError(null);
  }, []);

  const handleDelete = useCallback(async () => {
    if (deleteTarget === null) {
      return;
    }
    setDeleting(true);
    setDeleteError(null);
    try {
      await teamsApi.remove(deleteTarget.id);
      const name = deleteTarget.name;
      refreshList();
      closeDelete();
      notifications.show({
        color: 'green',
        title: 'Team deleted',
        message: `Deleted "${name}".`,
      });
    } catch (err: unknown) {
      // Keep the modal open and surface the reason (e.g. completed Games) both
      // inline and as a notification (Req 5.7, 10.4).
      const message = messageFor(err, 'Failed to delete the Team.');
      setDeleteError(message);
      notifications.show({
        color: 'red',
        title: 'Failed to delete the Team',
        message,
      });
    } finally {
      setDeleting(false);
    }
  }, [deleteTarget, refreshList, closeDelete]);

  const hasSeason = seasonId !== null;
  const showEmptyState = useMemo(
    () => hasSeason && !loading && error === null && items.length === 0,
    [hasSeason, loading, error, items.length],
  );

  return (
    <section aria-labelledby="teams-heading">
      <Stack gap="lg">
        <Title id="teams-heading" order={2}>
          Manage Teams
        </Title>

        <Stack gap="sm" maw={420}>
          <LeagueSelect
            value={leagueId}
            onChange={(id) => {
              setLeagueId(id);
              // Clearing / changing the League resets the dependent Season.
              setSeasonId(null);
            }}
          />
          <SeasonSelect
            leagueId={leagueId}
            value={seasonId}
            onChange={setSeasonId}
          />
        </Stack>

        {hasSeason ? (
          <>
            <section aria-labelledby="create-team-heading">
              <Stack gap="sm" maw={420}>
                <Title id="create-team-heading" order={3}>
                  Create a Team
                </Title>
                <form onSubmit={handleCreate} noValidate>
                  <Stack gap="sm">
                    <TextInput
                      label="Team name"
                      required
                      maxLength={100}
                      {...createForm.getInputProps('name')}
                    />
                    <Group>
                      <Button type="submit" loading={createForm.submitting}>
                        Create Team
                      </Button>
                    </Group>
                  </Stack>
                </form>
              </Stack>
            </section>

            <section aria-labelledby="team-list-heading">
              <Stack gap="sm">
                <Title id="team-list-heading" order={3}>
                  Teams
                </Title>

                {error !== null ? (
                  <Alert role="alert" color="red" title="Failed to load teams">
                    <Stack gap="xs" align="flex-start">
                      <Text size="sm">{error}</Text>
                      <Button size="xs" variant="light" onClick={reload}>
                        Retry
                      </Button>
                    </Stack>
                  </Alert>
                ) : null}

                {loading ? <Text role="status">Loading teams…</Text> : null}

                {showEmptyState ? (
                  <Text role="status" c="dimmed">
                    No teams in this season yet. Create the first Team above.
                  </Text>
                ) : null}

                {!loading && error === null && items.length > 0 ? (
                  <Table striped highlightOnHover>
                    <Table.Caption>Teams in the selected season</Table.Caption>
                    <Table.Thead>
                      <Table.Tr>
                        <Table.Th scope="col">Name</Table.Th>
                        <Table.Th scope="col">Actions</Table.Th>
                      </Table.Tr>
                    </Table.Thead>
                    <Table.Tbody>
                      {items.map((team) => (
                        <Table.Tr key={team.id}>
                          <Table.Td>{team.name}</Table.Td>
                          <Table.Td>
                            <Group gap="xs">
                              <Button
                                size="xs"
                                variant="light"
                                onClick={() => openRename(team)}
                              >
                                Rename
                              </Button>
                              <Button
                                size="xs"
                                variant="light"
                                color="red"
                                onClick={() => openDelete(team)}
                              >
                                Delete
                              </Button>
                              <Button
                                size="xs"
                                variant="subtle"
                                component={Link}
                                to={`/manage/players?team=${encodeURIComponent(team.id)}`}
                              >
                                Manage roster
                              </Button>
                            </Group>
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
            Select a league and a season to manage its teams.
          </Text>
        )}
      </Stack>

      {/* Rename modal — replaces window.prompt (Req 5.5, 10.6). */}
      <Modal
        opened={renameTarget !== null}
        onClose={closeRename}
        title="Rename Team"
      >
        <form onSubmit={handleRename} noValidate>
          <Stack gap="sm">
            <TextInput
              label="Team name"
              required
              maxLength={100}
              data-autofocus
              {...renameForm.getInputProps('name')}
            />
            <Group justify="flex-end">
              <Button variant="default" onClick={closeRename} type="button">
                Cancel
              </Button>
              <Button type="submit" loading={renameForm.submitting}>
                Save
              </Button>
            </Group>
          </Stack>
        </form>
      </Modal>

      {/* Delete confirm modal — replaces window.confirm (Req 5.6, 10.6). */}
      <Modal
        opened={deleteTarget !== null}
        onClose={closeDelete}
        title="Delete Team"
      >
        <Stack gap="sm">
          <Text>
            Delete Team &quot;{deleteTarget?.name}&quot;? This cannot be undone.
          </Text>
          {deleteError !== null ? (
            <Alert role="alert" color="red" title="Could not delete">
              {deleteError}
            </Alert>
          ) : null}
          <Group justify="flex-end">
            <Button variant="default" onClick={closeDelete} type="button">
              Cancel
            </Button>
            <Button color="red" onClick={() => void handleDelete()} loading={deleting}>
              Delete
            </Button>
          </Group>
        </Stack>
      </Modal>
    </section>
  );
}
