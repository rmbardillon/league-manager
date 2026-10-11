/**
 * Awards management page (Manage > Awards) - Requirement 13.
 *
 * An Administrator selects a scope (a Season) and can:
 *   - compute the scope's Awards via `awardsApi.compute`; newly computed Awards
 *     are stored UNPUBLISHED (Req 13.13-13.16). The no-statistics (Req 13.16)
 *     and no-Finals (Req 13.12) indicators are surfaced, not treated as errors;
 *   - review every computed Award (published + unpublished) via
 *     `awardsApi.adminList`;
 *   - publish the scope's Awards via `awardsApi.publish` so Viewers can see
 *     them on the public Awards page (Req 13.13).
 *
 * Awards reference players by id; player names are resolved from the master
 * registry for display. The whole page is gated to Administrators.
 */
import { useCallback, useMemo, useState } from 'react';
import {
  Alert,
  Badge,
  Button,
  Card,
  Group,
  Stack,
  Table,
  Text,
  Title,
} from '@mantine/core';
import { notifications } from '@mantine/notifications';

import {
  ApiError,
  awardsApi,
  playersApi,
  type Award,
  type AwardCategory,
  type Player,
} from '../../api/index.js';
import { useResourceList } from '../../hooks/useResourceList.js';
import { LeagueSelect } from '../../components/selectors/LeagueSelect.js';
import { SeasonSelect } from '../../components/selectors/SeasonSelect.js';
import classes from './ManageHome.module.css';

const CATEGORY_LABELS: Record<AwardCategory, string> = {
  MVP: 'Most Valuable Player',
  Mythical_5: 'Mythical Five',
  Best_in_3_Pointers: 'Best in 3-Pointers',
  DPOY: 'Defensive Player of the Year',
  Assists_Leader: 'Assists Leader',
  Finals_MVP: 'Finals MVP',
};

function messageFor(error: unknown, fallback: string): string {
  return error instanceof ApiError ? error.message : fallback;
}

export function AwardsPage(): JSX.Element {
  const [leagueId, setLeagueId] = useState<string | null>(null);
  const [scopeId, setScopeId] = useState<string | null>(null);
  const [awards, setAwards] = useState<Award[] | null>(null);
  const [loadingAwards, setLoadingAwards] = useState(false);
  const [awardsError, setAwardsError] = useState<string | null>(null);
  const [computing, setComputing] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  // Master players for id -> name display.
  const { items: players } = useResourceList<Player>(
    useCallback((signal: AbortSignal) => playersApi.listMasters(signal), []),
    '/players',
  );
  const nameById = useMemo(
    () => new Map(players.map((p) => [p.id, p.name])),
    [players],
  );
  const playerName = useCallback(
    (id: string) => nameById.get(id) ?? id,
    [nameById],
  );

  const loadAwards = useCallback(async (scope: string) => {
    setLoadingAwards(true);
    setAwardsError(null);
    try {
      const payload = await awardsApi.adminList(scope);
      setAwards(payload.awards);
    } catch (err: unknown) {
      setAwardsError(messageFor(err, 'Failed to load awards.'));
    } finally {
      setLoadingAwards(false);
    }
  }, []);

  const onScopeChange = useCallback(
    (id: string | null) => {
      setScopeId(id);
      setAwards(null);
      setAwardsError(null);
      setNotice(null);
      if (id !== null) void loadAwards(id);
    },
    [loadAwards],
  );

  const handleCompute = useCallback(async () => {
    if (scopeId === null) return;
    setComputing(true);
    setNotice(null);
    try {
      const result = await awardsApi.compute(scopeId);
      setAwards(result.awards);
      const notes: string[] = [];
      if (!result.regularSeasonAvailable) {
        notes.push('No regular-season statistics were found, so no stat-based awards were computed.');
      }
      if (!result.finalsMvpAvailable) {
        notes.push('No completed Finals games, so no Finals MVP was computed.');
      }
      setNotice(notes.join(' '));
      notifications.show({
        color: 'green',
        title: 'Awards computed',
        message: `${result.awards.length} award(s) computed (unpublished).`,
      });
    } catch (err: unknown) {
      notifications.show({
        color: 'red',
        title: 'Could not compute awards',
        message: messageFor(err, 'Failed to compute awards.'),
      });
    } finally {
      setComputing(false);
    }
  }, [scopeId]);

  const handlePublish = useCallback(async () => {
    if (scopeId === null) return;
    setPublishing(true);
    try {
      const result = await awardsApi.publish(scopeId);
      setAwards(result.awards);
      notifications.show({
        color: 'green',
        title: 'Awards published',
        message: 'Viewers can now see these awards.',
      });
    } catch (err: unknown) {
      notifications.show({
        color: 'red',
        title: 'Could not publish awards',
        message: messageFor(err, 'Failed to publish awards.'),
      });
    } finally {
      setPublishing(false);
    }
  }, [scopeId]);

  const hasScope = scopeId !== null;
  const hasAwards = awards !== null && awards.length > 0;
  const anyUnpublished = (awards ?? []).some((a) => !a.published);

  return (
    <section aria-labelledby="awards-heading">
      <Stack gap="lg">
        <Title id="awards-heading" order={2} className={classes.title}>
          Awards
        </Title>

        <Stack gap="sm" maw={420}>
          <LeagueSelect
            value={leagueId}
            onChange={(id) => {
              setLeagueId(id);
              onScopeChange(null);
            }}
          />
          <SeasonSelect leagueId={leagueId} value={scopeId} onChange={onScopeChange} label="Season (scope)" />
        </Stack>

        {hasScope ? (
          <>
            <Group>
              <Button onClick={() => void handleCompute()} loading={computing}>
                Compute awards
              </Button>
              <Button
                variant="light"
                onClick={() => void handlePublish()}
                loading={publishing}
                disabled={!hasAwards || !anyUnpublished}
              >
                Publish awards
              </Button>
            </Group>

            {notice ? (
              <Alert color="nba-blue" variant="light" title="Note">{notice}</Alert>
            ) : null}
            {awardsError !== null ? (
              <Alert role="alert" color="nba-red" title="Could not load awards">{awardsError}</Alert>
            ) : null}
            {loadingAwards ? <Text role="status">Loading awards...</Text> : null}
            {awards !== null && awards.length === 0 && !loadingAwards ? (
              <Text role="status" c="dimmed">
                No awards computed for this scope yet. Compute awards above.
              </Text>
            ) : null}

            {hasAwards ? (
              <Card withBorder radius="md" padding={0}>
                <Table.ScrollContainer minWidth={560}>
                  <Table>
                    <Table.Thead>
                      <Table.Tr>
                        <Table.Th>Award</Table.Th>
                        <Table.Th>Recipient(s)</Table.Th>
                        <Table.Th>Status</Table.Th>
                      </Table.Tr>
                    </Table.Thead>
                    <Table.Tbody>
                      {awards!.map((award) => (
                        <Table.Tr key={award.id}>
                          <Table.Td>{CATEGORY_LABELS[award.category] ?? award.category}</Table.Td>
                          <Table.Td>
                            {award.playerIds.map((id) => playerName(id)).join(', ')}
                          </Table.Td>
                          <Table.Td>
                            <Badge
                              color={award.published ? 'green' : 'gray'}
                              variant="light"
                              radius="sm"
                            >
                              {award.published ? 'Published' : 'Unpublished'}
                            </Badge>
                          </Table.Td>
                        </Table.Tr>
                      ))}
                    </Table.Tbody>
                  </Table>
                </Table.ScrollContainer>
              </Card>
            ) : null}
          </>
        ) : (
          <Text role="status" c="dimmed">Select a league and a season to manage its awards.</Text>
        )}
      </Stack>
    </section>
  );
}