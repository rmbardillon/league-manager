/**
 * Players master-data registry (Manage > Players).
 *
 * A standalone, league-wide registry of master Players (the person model
 * `{ id, name }`, independent of any Team). An Administrator can:
 *   - register a new Player (name 1-100);
 *   - rename a Player via a modal form;
 *   - remove a Player via a confirm modal (the backend rejects removal with a
 *     409 when the Player is still assigned to a Team, surfaced inline).
 *
 * This is the source the Manage Roster view picks from when assigning a Player
 * to a Team. After each mutation the shared `/players` cache key is invalidated
 * so the roster `PlayerSelect` reflects the change immediately.
 *
 * Every master-Player endpoint is Administrator-scoped, so the whole page is
 * gated to Administrators by the route guard.
 */
import { useCallback, useMemo, useState } from 'react';
import {
  Alert,
  Button,
  Card,
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
  playersApi,
  type Player,
  type PlayerHistoryEntry,
} from '../../api/index.js';
import { invalidate } from '../../api/resourceCache.js';
import { useResourceList } from '../../hooks/useResourceList.js';
import classes from './ManageHome.module.css';

/** The master-Player registry cache key (shared with the roster PlayerSelect). */
const PLAYERS_KEY = '/players';

/** Client-side name bound mirroring the server (1-100 chars). */
function validateName(value: string): string | null {
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    return 'Enter a player name.';
  }
  if (trimmed.length > 100) {
    return 'Player name must be at most 100 characters.';
  }
  return null;
}

/** The message to show for a failed mutation (server message when available). */
function messageFor(error: unknown, fallback: string): string {
  return error instanceof ApiError ? error.message : fallback;
}

interface NameFormValues {
  name: string;
}

export function PlayersRegistryPage(): JSX.Element {
  const [renameTarget, setRenameTarget] = useState<Player | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<Player | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [historyTarget, setHistoryTarget] = useState<Player | null>(null);
  const [history, setHistory] = useState<PlayerHistoryEntry[] | null>(null);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyError, setHistoryError] = useState<string | null>(null);

  const loader = useCallback(
    (signal: AbortSignal) => playersApi.listMasters(signal),
    [],
  );
  const { items, loading, error, reload } = useResourceList<Player>(loader, PLAYERS_KEY);

  const createForm = useForm<NameFormValues>({
    initialValues: { name: '' },
    validate: { name: validateName },
  });

  const renameForm = useForm<NameFormValues>({
    initialValues: { name: '' },
    validate: { name: validateName },
  });

  const refresh = useCallback(() => {
    invalidate(PLAYERS_KEY);
    reload();
  }, [reload]);

  const handleCreate = createForm.onSubmit(async (values) => {
    try {
      const created = await playersApi.createMaster({ name: values.name.trim() });
      refresh();
      createForm.reset();
      notifications.show({
        color: 'green',
        title: 'Player registered',
        message: `Added "${created.name}" to the registry.`,
      });
    } catch (err: unknown) {
      if (err instanceof ApiError && err.category === 'ValidationError') {
        createForm.setFieldError('name', messageFor(err, 'Invalid player name.'));
        return;
      }
      notifications.show({
        color: 'red',
        title: 'Failed to register the player',
        message: messageFor(err, 'Failed to register the player.'),
      });
    }
  });

  const openRename = useCallback(
    (player: Player) => {
      setRenameTarget(player);
      renameForm.setValues({ name: player.name });
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
      const updated = await playersApi.rename(renameTarget.id, { name: values.name.trim() });
      refresh();
      closeRename();
      notifications.show({
        color: 'green',
        title: 'Player renamed',
        message: `Renamed to "${updated.name}".`,
      });
    } catch (err: unknown) {
      if (err instanceof ApiError && err.category === 'ValidationError') {
        renameForm.setFieldError('name', messageFor(err, 'Invalid player name.'));
        return;
      }
      notifications.show({
        color: 'red',
        title: 'Failed to rename the player',
        message: messageFor(err, 'Failed to rename the player.'),
      });
    }
  });

  const openDelete = useCallback((player: Player) => {
    setDeleteError(null);
    setDeleteTarget(player);
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
      await playersApi.remove(deleteTarget.id);
      const name = deleteTarget.name;
      refresh();
      closeDelete();
      notifications.show({
        color: 'green',
        title: 'Player removed',
        message: `Removed "${name}" from the registry.`,
      });
    } catch (err: unknown) {
      // A Player still assigned to a Team cannot be removed (409); keep the
      // modal open and surface the reason both inline and as a notification.
      const message = messageFor(err, 'Failed to remove the player.');
      setDeleteError(message);
      notifications.show({
        color: 'red',
        title: 'Failed to remove the player',
        message,
      });
    } finally {
      setDeleting(false);
    }
  }, [deleteTarget, refresh, closeDelete]);

  const openHistory = useCallback(async (player: Player) => {
    setHistoryTarget(player);
    setHistory(null);
    setHistoryError(null);
    setHistoryLoading(true);
    try {
      const entries = await playersApi.history(player.id);
      setHistory(entries);
    } catch (err: unknown) {
      setHistoryError(err instanceof ApiError ? err.message : 'Failed to load history.');
    } finally {
      setHistoryLoading(false);
    }
  }, []);

  const closeHistory = useCallback(() => {
    setHistoryTarget(null);
    setHistory(null);
    setHistoryError(null);
  }, []);

  const showEmptyState = useMemo(
    () => !loading && error === null && items.length === 0,
    [loading, error, items.length],
  );

  return (
    <section aria-labelledby="players-heading">
      <Stack gap="lg">
        <Title id="players-heading" order={2} className={classes.title}>
          Players
        </Title>

        <Text c="dimmed" maw={640}>
          The league-wide player registry. Register players here, then assign
          them to a team from Manage Roster.
        </Text>

        <section aria-labelledby="register-player-heading">
          <Card withBorder radius="md" padding="lg" maw={420}>
            <Stack gap="sm">
              <Title id="register-player-heading" order={3}>
                Register a Player
              </Title>
              <form onSubmit={handleCreate} noValidate>
                <Stack gap="sm">
                  <TextInput
                    label="Player name"
                    required
                    maxLength={100}
                    {...createForm.getInputProps('name')}
                  />
                  <Group>
                    <Button type="submit" loading={createForm.submitting}>
                      Register Player
                    </Button>
                  </Group>
                </Stack>
              </form>
            </Stack>
          </Card>
        </section>

        <section aria-labelledby="player-list-heading">
          <Stack gap="sm">
            <Title id="player-list-heading" order={3}>
              All Players
            </Title>

            {error !== null ? (
              <Alert role="alert" color="nba-red" title="Failed to load players">
                <Stack gap="xs" align="flex-start">
                  <Text size="sm">{error}</Text>
                  <Button size="xs" variant="light" onClick={reload}>
                    Retry
                  </Button>
                </Stack>
              </Alert>
            ) : null}

            {loading ? <Text role="status">Loading players...</Text> : null}

            {showEmptyState ? (
              <Text role="status" c="dimmed">
                No players registered yet. Register the first player above.
              </Text>
            ) : null}

            {!loading && error === null && items.length > 0 ? (
              <Card withBorder radius="md" padding={0}>
                <Table.ScrollContainer minWidth={420}>
                  <Table>
                    <Table.Thead>
                      <Table.Tr>
                        <Table.Th>Name</Table.Th>
                        <Table.Th>Actions</Table.Th>
                      </Table.Tr>
                    </Table.Thead>
                    <Table.Tbody>
                      {items.map((player) => (
                        <Table.Tr key={player.id}>
                          <Table.Td>{player.name}</Table.Td>
                          <Table.Td>
                            <Group gap="xs">
                              <Button
                                size="xs"
                                variant="light"
                                onClick={() => openRename(player)}
                              >
                                Rename
                              </Button>
                              <Button
                                size="xs"
                                variant="subtle"
                                onClick={() => void openHistory(player)}
                              >
                                History
                              </Button>
                              <Button
                                size="xs"
                                variant="light"
                                color="nba-red"
                                onClick={() => openDelete(player)}
                              >
                                Remove
                              </Button>
                            </Group>
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
      </Stack>

      {/* Rename modal. */}
      <Modal opened={renameTarget !== null} onClose={closeRename} title="Rename Player">
        <form onSubmit={handleRename} noValidate>
          <Stack gap="sm">
            <TextInput
              label="Player name"
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

      {/* Remove confirm modal. */}
      <Modal opened={deleteTarget !== null} onClose={closeDelete} title="Remove Player">
        <Stack gap="sm">
          <Text>
            Remove player &quot;{deleteTarget?.name}&quot; from the registry? A
            player who is still assigned to a team cannot be removed.
          </Text>
          {deleteError !== null ? (
            <Alert role="alert" color="nba-red" title="Could not remove">
              {deleteError}
            </Alert>
          ) : null}
          <Group justify="flex-end">
            <Button variant="default" onClick={closeDelete} type="button">
              Cancel
            </Button>
            <Button color="nba-red" onClick={() => void handleDelete()} loading={deleting}>
              Remove
            </Button>
          </Group>
        </Stack>
      </Modal>

      {/* History modal. */}
      <Modal
        opened={historyTarget !== null}
        onClose={closeHistory}
        title={historyTarget ? `History: ${historyTarget.name}` : 'History'}
      >
        <Stack gap="sm">
          {historyLoading ? <Text role="status">Loading history...</Text> : null}
          {historyError !== null ? (
            <Alert role="alert" color="nba-red" title="Could not load history">
              {historyError}
            </Alert>
          ) : null}
          {history !== null && history.length === 0 ? (
            <Text role="status" c="dimmed">
              This player has no team assignments yet.
            </Text>
          ) : null}
          {history !== null && history.length > 0 ? (
            <Table withTableBorder>
              <Table.Thead>
                <Table.Tr>
                  <Table.Th>Team</Table.Th>
                  <Table.Th>Season</Table.Th>
                  <Table.Th>Jersey</Table.Th>
                </Table.Tr>
              </Table.Thead>
              <Table.Tbody>
                {history.map((entry) => (
                  <Table.Tr key={entry.assignmentId}>
                    <Table.Td>{entry.teamId}</Table.Td>
                    <Table.Td>{entry.seasonId}</Table.Td>
                    <Table.Td>{entry.jerseyNumber}</Table.Td>
                  </Table.Tr>
                ))}
              </Table.Tbody>
            </Table>
          ) : null}
        </Stack>
      </Modal>
    </section>
  );
}