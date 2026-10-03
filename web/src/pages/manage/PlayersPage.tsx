/**
 * Roster management view, master-Player + assignment model (Req 6.1–6.10, 10.4–10.6, 11.3).
 *
 * A User picks a League then a Season then a Team through named selectors
 * (Req 6.1, 3.x) and sees that Team's real Roster loaded from
 * `GET /teams/:teamId/roster` (name + jersey number). Because the list is
 * API-backed it survives a page refresh — nothing is tracked in session-only
 * React state (Req 6.2).
 *
 * From the view an authorized User can:
 *   - assign an existing master Player (via a `PlayerSelect`) with a jersey
 *     number of 0–99 through `assignmentsApi.assign` (Req 6.4);
 *   - register a brand-new master Player (name 1–100) and assign it in one flow
 *     through a modal — `playersApi.createMaster` then `assignmentsApi.assign`.
 *     This action is shown only to an Administrator, since `POST /players` is
 *     Admin-scoped (Req 6.5);
 *   - change an assignment's jersey number through a modal form via
 *     `assignmentsApi.updateJersey` (Req 6.8);
 *   - unassign a Player through a confirm modal via `assignmentsApi.unassign`;
 *     the master Player is retained (Req 6.9).
 *
 * Authorization (Req 6.3, 11.3): when the signed-in principal is a Team_Manager
 * who does not manage the selected Team (`!canManageTeam(teamId)`), the assign,
 * change-jersey, unassign, and new-player controls render disabled and an
 * accessible notice explains why. An Administrator may manage any Team.
 *
 * After each successful mutation the roster cache key `/teams/:teamId/roster`
 * is invalidated and the list refetched (Req 6.4, 6.8, 6.9); when a new master
 * Player was created the `/players` key is invalidated too so the Player
 * selector reflects it. Success and failure surface through Mantine
 * notifications (Req 10.5). Jersey bounds are validated client-side mirroring
 * the server (Req 6.6); `ConflictError` (duplicate jersey or a second
 * same-Season assignment) and `ValidationError` surface inline on the assign
 * form (Req 6.6, 6.7). An empty Roster shows an accessible empty state
 * inviting the first assignment (Req 6.10).
 */
import { useCallback, useMemo, useState } from 'react';
import {
  Alert,
  Button,
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
  assignmentsApi,
  playersApi,
  type RosterEntry,
} from '../../api/index.js';
import { invalidate } from '../../api/resourceCache.js';
import { useAuth } from '../../auth/AuthContext.js';
import { useResourceList } from '../../hooks/useResourceList.js';
import { LeagueSelect } from '../../components/selectors/LeagueSelect.js';
import { SeasonSelect } from '../../components/selectors/SeasonSelect.js';
import { TeamSelect } from '../../components/selectors/TeamSelect.js';
import { PlayerSelect } from '../../components/selectors/PlayerSelect.js';

/** The master-Player registry key the PlayerSelect loads from. */
const PLAYERS_KEY = '/players';

/** Client-side name bound for the "new player" modal (Req 6.5). */
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

/**
 * Client-side jersey bound mirroring the server (0–99 integer, Req 6.6). The
 * Mantine `NumberInput` yields a `number` on valid entry or `''` while empty.
 */
function validateJersey(value: number | string): string | null {
  if (value === '' || value === null || value === undefined) {
    return 'Enter a jersey number.';
  }
  const n = typeof value === 'number' ? value : Number(value);
  if (!Number.isInteger(n)) {
    return 'Jersey number must be a whole number.';
  }
  if (n < 0 || n > 99) {
    return 'Jersey number must be between 0 and 99.';
  }
  return null;
}

/** The message to show for a failed mutation (server message when available). */
function messageFor(error: unknown, fallback: string): string {
  return error instanceof ApiError ? error.message : fallback;
}

/** True when the error is a conflict (duplicate jersey / second same-Season assignment). */
function isConflict(error: unknown): error is ApiError {
  return error instanceof ApiError && error.category === 'ConflictError';
}

/** True when the error is a server-side validation failure (e.g. jersey range). */
function isValidation(error: unknown): error is ApiError {
  return error instanceof ApiError && error.category === 'ValidationError';
}

interface AssignFormValues {
  playerId: string | null;
  jerseyNumber: number | string;
}

interface NewPlayerFormValues {
  name: string;
  jerseyNumber: number | string;
}

interface JerseyFormValues {
  jerseyNumber: number | string;
}

export function PlayersPage(): JSX.Element {
  const { isAdmin, isTeamManager, canManageTeam } = useAuth();

  const [leagueId, setLeagueId] = useState<string | null>(null);
  const [seasonId, setSeasonId] = useState<string | null>(null);
  const [teamId, setTeamId] = useState<string | null>(null);

  // The assignment whose jersey is being edited / which is being unassigned.
  const [jerseyTarget, setJerseyTarget] = useState<RosterEntry | null>(null);
  const [unassignTarget, setUnassignTarget] = useState<RosterEntry | null>(null);
  const [unassigning, setUnassigning] = useState(false);
  const [unassignError, setUnassignError] = useState<string | null>(null);

  // The "new player" modal is Admin-only (POST /players is Admin-scoped).
  const [newPlayerOpen, setNewPlayerOpen] = useState(false);
  const [newPlayerBusy, setNewPlayerBusy] = useState(false);

  const listKey = teamId !== null ? `/teams/${teamId}/roster` : null;
  const rosterLoader = useCallback(
    (signal: AbortSignal) => assignmentsApi.roster(teamId as string, signal),
    [teamId],
  );

  const { items, loading, error, reload } = useResourceList<RosterEntry>(
    rosterLoader,
    listKey,
  );

  // A Team_Manager may only manage Teams assigned to them; an Administrator may
  // manage any Team. When a Team is selected but unmanaged, mutation controls
  // are disabled with a notice (Req 6.3, 11.3).
  const hasTeam = teamId !== null;
  const unmanaged = hasTeam && isTeamManager && !canManageTeam(teamId);
  const controlsDisabled = !hasTeam || unmanaged;

  const assignForm = useForm<AssignFormValues>({
    initialValues: { playerId: null, jerseyNumber: '' },
    validate: {
      playerId: (value) => (value === null ? 'Select a player.' : null),
      jerseyNumber: validateJersey,
    },
  });

  const newPlayerForm = useForm<NewPlayerFormValues>({
    initialValues: { name: '', jerseyNumber: '' },
    validate: {
      name: validateName,
      jerseyNumber: validateJersey,
    },
  });

  const jerseyForm = useForm<JerseyFormValues>({
    initialValues: { jerseyNumber: '' },
    validate: { jerseyNumber: validateJersey },
  });

  /** Invalidate the roster key (and optionally /players) then refetch. */
  const refreshRoster = useCallback(
    (alsoPlayers = false) => {
      if (listKey !== null) {
        invalidate(listKey);
      }
      if (alsoPlayers) {
        invalidate(PLAYERS_KEY);
      }
      reload();
    },
    [listKey, reload],
  );

  /**
   * Route a conflict / validation error inline onto the assign (or new-player)
   * form, preferring the `jerseyNumber`/`playerId` field. Returns true when it
   * was surfaced inline so the caller can skip the notification (Req 6.6, 6.7).
   */
  const surfaceAssignError = useCallback(
    (
      err: unknown,
      form: {
        setFieldError: (field: string, message: string) => void;
      },
      jerseyField: string,
    ): boolean => {
      if (isConflict(err) || isValidation(err)) {
        form.setFieldError(jerseyField, messageFor(err, 'Invalid assignment.'));
        return true;
      }
      return false;
    },
    [],
  );

  const handleAssign = assignForm.onSubmit(async (values) => {
    if (teamId === null || values.playerId === null) {
      return;
    }
    try {
      await assignmentsApi.assign(teamId, {
        playerId: values.playerId,
        jerseyNumber: Number(values.jerseyNumber),
      });
      refreshRoster();
      assignForm.reset();
      notifications.show({
        color: 'green',
        title: 'Player assigned',
        message: 'Added the Player to the roster.',
      });
    } catch (err: unknown) {
      if (surfaceAssignError(err, assignForm, 'jerseyNumber')) {
        return;
      }
      notifications.show({
        color: 'red',
        title: 'Failed to assign the Player',
        message: messageFor(err, 'Failed to assign the Player.'),
      });
    }
  });

  const openNewPlayer = useCallback(() => {
    newPlayerForm.reset();
    setNewPlayerOpen(true);
  }, [newPlayerForm]);

  const closeNewPlayer = useCallback(() => {
    setNewPlayerOpen(false);
    newPlayerForm.reset();
  }, [newPlayerForm]);

  const handleNewPlayer = newPlayerForm.onSubmit(async (values) => {
    if (teamId === null) {
      return;
    }
    setNewPlayerBusy(true);
    try {
      // Register the master Player first, then assign it to this Team (Req 6.5).
      const created = await playersApi.createMaster({ name: values.name.trim() });
      try {
        await assignmentsApi.assign(teamId, {
          playerId: created.id,
          jerseyNumber: Number(values.jerseyNumber),
        });
      } catch (assignErr: unknown) {
        // The master Player was created but the assignment failed. Refresh the
        // Player registry so the new master is selectable, surface the reason
        // inline, and keep the modal open so the User can retry a jersey.
        refreshRoster(true);
        if (surfaceAssignError(assignErr, newPlayerForm, 'jerseyNumber')) {
          return;
        }
        notifications.show({
          color: 'red',
          title: 'Player created but not assigned',
          message: messageFor(
            assignErr,
            'The Player was created but could not be assigned.',
          ),
        });
        return;
      }
      refreshRoster(true);
      closeNewPlayer();
      notifications.show({
        color: 'green',
        title: 'Player created and assigned',
        message: `Created "${created.name}" and added them to the roster.`,
      });
    } catch (err: unknown) {
      // Failure of the master-Player creation itself (e.g. name validation).
      if (isValidation(err) || isConflict(err)) {
        newPlayerForm.setFieldError('name', messageFor(err, 'Invalid player name.'));
        return;
      }
      notifications.show({
        color: 'red',
        title: 'Failed to create the Player',
        message: messageFor(err, 'Failed to create the Player.'),
      });
    } finally {
      setNewPlayerBusy(false);
    }
  });

  const openJersey = useCallback(
    (entry: RosterEntry) => {
      setJerseyTarget(entry);
      jerseyForm.setValues({ jerseyNumber: entry.jerseyNumber });
      jerseyForm.clearErrors();
    },
    [jerseyForm],
  );

  const closeJersey = useCallback(() => {
    setJerseyTarget(null);
    jerseyForm.reset();
  }, [jerseyForm]);

  const handleJersey = jerseyForm.onSubmit(async (values) => {
    if (teamId === null || jerseyTarget === null) {
      return;
    }
    try {
      await assignmentsApi.updateJersey(teamId, jerseyTarget.playerId, {
        jerseyNumber: Number(values.jerseyNumber),
      });
      const name = jerseyTarget.name;
      refreshRoster();
      closeJersey();
      notifications.show({
        color: 'green',
        title: 'Jersey updated',
        message: `Updated the jersey number for "${name}".`,
      });
    } catch (err: unknown) {
      if (isConflict(err) || isValidation(err)) {
        jerseyForm.setFieldError(
          'jerseyNumber',
          messageFor(err, 'Invalid jersey number.'),
        );
        return;
      }
      notifications.show({
        color: 'red',
        title: 'Failed to update the jersey',
        message: messageFor(err, 'Failed to update the jersey number.'),
      });
    }
  });

  const openUnassign = useCallback((entry: RosterEntry) => {
    setUnassignError(null);
    setUnassignTarget(entry);
  }, []);

  const closeUnassign = useCallback(() => {
    setUnassignTarget(null);
    setUnassignError(null);
  }, []);

  const handleUnassign = useCallback(async () => {
    if (teamId === null || unassignTarget === null) {
      return;
    }
    setUnassigning(true);
    setUnassignError(null);
    try {
      await assignmentsApi.unassign(teamId, unassignTarget.playerId);
      const name = unassignTarget.name;
      refreshRoster();
      closeUnassign();
      notifications.show({
        color: 'green',
        title: 'Player unassigned',
        message: `Removed "${name}" from the roster.`,
      });
    } catch (err: unknown) {
      const message = messageFor(err, 'Failed to unassign the Player.');
      setUnassignError(message);
      notifications.show({
        color: 'red',
        title: 'Failed to unassign the Player',
        message,
      });
    } finally {
      setUnassigning(false);
    }
  }, [teamId, unassignTarget, refreshRoster, closeUnassign]);

  const showEmptyState = useMemo(
    () => hasTeam && !loading && error === null && items.length === 0,
    [hasTeam, loading, error, items.length],
  );

  return (
    <section aria-labelledby="roster-heading">
      <Stack gap="lg">
        <Title id="roster-heading" order={2}>
          Manage Roster
        </Title>

        <Stack gap="sm" maw={420}>
          <LeagueSelect
            value={leagueId}
            onChange={(id) => {
              setLeagueId(id);
              // Clearing / changing the League resets the dependent Season/Team.
              setSeasonId(null);
              setTeamId(null);
            }}
          />
          <SeasonSelect
            leagueId={leagueId}
            value={seasonId}
            onChange={(id) => {
              setSeasonId(id);
              setTeamId(null);
            }}
          />
          <TeamSelect seasonId={seasonId} value={teamId} onChange={setTeamId} />
        </Stack>

        {hasTeam ? (
          <>
            {unmanaged ? (
              <Alert role="alert" color="yellow" title="Not authorized">
                You are not assigned to manage this Team, so the assign,
                change-jersey, unassign, and new-player controls are
                unavailable.
              </Alert>
            ) : null}

            <section aria-labelledby="assign-player-heading">
              <Stack gap="sm" maw={420}>
                <Title id="assign-player-heading" order={3}>
                  Assign a Player
                </Title>
                <form onSubmit={handleAssign} noValidate>
                  <Stack gap="sm">
                    <PlayerSelect
                      value={assignForm.values.playerId}
                      onChange={(id) =>
                        assignForm.setFieldValue('playerId', id)
                      }
                      required
                      disabled={controlsDisabled}
                    />
                    {assignForm.errors.playerId ? (
                      <Text role="alert" size="sm" c="red">
                        {assignForm.errors.playerId}
                      </Text>
                    ) : null}
                    <NumberInput
                      label="Jersey number"
                      required
                      min={0}
                      max={99}
                      step={1}
                      allowDecimal={false}
                      allowNegative={false}
                      clampBehavior="strict"
                      disabled={controlsDisabled}
                      {...assignForm.getInputProps('jerseyNumber')}
                    />
                    <Group>
                      <Button
                        type="submit"
                        loading={assignForm.submitting}
                        disabled={controlsDisabled}
                      >
                        Assign Player
                      </Button>
                      {isAdmin ? (
                        <Button
                          type="button"
                          variant="light"
                          onClick={openNewPlayer}
                          disabled={controlsDisabled}
                        >
                          New player
                        </Button>
                      ) : null}
                    </Group>
                  </Stack>
                </form>
              </Stack>
            </section>

            <section aria-labelledby="roster-list-heading">
              <Stack gap="sm">
                <Title id="roster-list-heading" order={3}>
                  Roster
                </Title>

                {error !== null ? (
                  <Alert role="alert" color="red" title="Failed to load roster">
                    <Stack gap="xs" align="flex-start">
                      <Text size="sm">{error}</Text>
                      <Button size="xs" variant="light" onClick={reload}>
                        Retry
                      </Button>
                    </Stack>
                  </Alert>
                ) : null}

                {loading ? <Text role="status">Loading roster…</Text> : null}

                {showEmptyState ? (
                  <Text role="status" c="dimmed">
                    No players on this team yet. Assign the first Player above.
                  </Text>
                ) : null}

                {!loading && error === null && items.length > 0 ? (
                  <Table striped highlightOnHover>
                    <Table.Caption>Players on the selected team</Table.Caption>
                    <Table.Thead>
                      <Table.Tr>
                        <Table.Th scope="col">Name</Table.Th>
                        <Table.Th scope="col">Jersey</Table.Th>
                        <Table.Th scope="col">Actions</Table.Th>
                      </Table.Tr>
                    </Table.Thead>
                    <Table.Tbody>
                      {items.map((entry) => (
                        <Table.Tr key={entry.playerId}>
                          <Table.Td>{entry.name}</Table.Td>
                          <Table.Td>{entry.jerseyNumber}</Table.Td>
                          <Table.Td>
                            <Group gap="xs">
                              <Button
                                size="xs"
                                variant="light"
                                onClick={() => openJersey(entry)}
                                disabled={controlsDisabled}
                              >
                                Change jersey
                              </Button>
                              <Button
                                size="xs"
                                variant="light"
                                color="red"
                                onClick={() => openUnassign(entry)}
                                disabled={controlsDisabled}
                              >
                                Unassign
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
            Select a league, a season, and a team to manage its roster.
          </Text>
        )}
      </Stack>

      {/* New-player modal — Admin-only; creates a master Player then assigns (Req 6.5). */}
      <Modal
        opened={newPlayerOpen}
        onClose={closeNewPlayer}
        title="New player"
      >
        <form onSubmit={handleNewPlayer} noValidate>
          <Stack gap="sm">
            <TextInput
              label="Player name"
              required
              maxLength={100}
              data-autofocus
              {...newPlayerForm.getInputProps('name')}
            />
            <NumberInput
              label="Jersey number"
              required
              min={0}
              max={99}
              step={1}
              allowDecimal={false}
              allowNegative={false}
              clampBehavior="strict"
              {...newPlayerForm.getInputProps('jerseyNumber')}
            />
            <Group justify="flex-end">
              <Button variant="default" onClick={closeNewPlayer} type="button">
                Cancel
              </Button>
              <Button type="submit" loading={newPlayerBusy}>
                Create and assign
              </Button>
            </Group>
          </Stack>
        </form>
      </Modal>

      {/* Change-jersey modal (Req 6.8). */}
      <Modal
        opened={jerseyTarget !== null}
        onClose={closeJersey}
        title="Change jersey number"
      >
        <form onSubmit={handleJersey} noValidate>
          <Stack gap="sm">
            <Text>
              New jersey number for &quot;{jerseyTarget?.name}&quot;.
            </Text>
            <NumberInput
              label="Jersey number"
              required
              min={0}
              max={99}
              step={1}
              allowDecimal={false}
              allowNegative={false}
              clampBehavior="strict"
              data-autofocus
              {...jerseyForm.getInputProps('jerseyNumber')}
            />
            <Group justify="flex-end">
              <Button variant="default" onClick={closeJersey} type="button">
                Cancel
              </Button>
              <Button type="submit" loading={jerseyForm.submitting}>
                Save
              </Button>
            </Group>
          </Stack>
        </form>
      </Modal>

      {/* Unassign confirm modal — master Player retained (Req 6.9). */}
      <Modal
        opened={unassignTarget !== null}
        onClose={closeUnassign}
        title="Unassign Player"
      >
        <Stack gap="sm">
          <Text>
            Remove &quot;{unassignTarget?.name}&quot; from this team&apos;s
            roster? The Player record is retained and can be reassigned later.
          </Text>
          {unassignError !== null ? (
            <Alert role="alert" color="red" title="Could not unassign">
              {unassignError}
            </Alert>
          ) : null}
          <Group justify="flex-end">
            <Button variant="default" onClick={closeUnassign} type="button">
              Cancel
            </Button>
            <Button
              color="red"
              onClick={() => void handleUnassign()}
              loading={unassigning}
            >
              Unassign
            </Button>
          </Group>
        </Stack>
      </Modal>
    </section>
  );
}
