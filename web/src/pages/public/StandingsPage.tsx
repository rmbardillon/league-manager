/**
 * Public standings view (Req 10.4, 10.5, 10.6).
 *
 * Lists a Season's Standings — each row's rank, Team, wins, and losses. Open
 * Seasons are computed live; closed Seasons return the recorded snapshot, which
 * the view labels for clarity (Req 10.5). No sign-in is required (Req 10.6).
 */
import { useSearchParams } from 'react-router-dom';
import { Badge, Card, Stack, Table, Title } from '@mantine/core';
import { publicApi, type StandingsPayload } from '../../api/index.js';
import { useAsync } from '../../hooks/useAsync.js';
import { PublicSeasonSelect } from '../../components/PublicSeasonSelect.js';
import { EmptyMessage, ErrorMessage, LoadingIndicator } from '../../components/Feedback.js';
import pageClasses from './PublicPage.module.css';

export function StandingsPage(): JSX.Element {
  const [params, setParams] = useSearchParams();
  const seasonId = params.get('season') ?? '';

  const { data, loading, error } = useAsync<StandingsPayload>(
    (signal) => publicApi.standings(seasonId, signal),
    seasonId || null,
  );

  const setSeason = (id: string | null): void => {
    setParams(id ? { season: id } : {});
  };

  return (
    <section aria-labelledby="standings-heading">
      <Stack gap="lg">
        <Title order={2} id="standings-heading" className={pageClasses.pageTitle}>
          Standings
        </Title>
        <Card withBorder radius="md" padding="md" maw={420}>
          <PublicSeasonSelect value={seasonId || null} onChange={setSeason} id="standings-season-id" />
        </Card>

        {!seasonId && <EmptyMessage>Select a Season to view its standings.</EmptyMessage>}
        {loading && <LoadingIndicator label="Loading standings…" />}
        {error && <ErrorMessage>{error}</ErrorMessage>}

        {data && data.standings.length === 0 && (
          <EmptyMessage>
            {data.message ?? 'No Standings are available for this Season yet.'}
          </EmptyMessage>
        )}

        {data && data.standings.length > 0 && (
          <Stack gap="sm">
            {data.closed && (
              <Badge role="status" color="nba-red" variant="light" radius="sm" className={pageClasses.badge}>
                Final standings recorded at season close
              </Badge>
            )}
            <Card withBorder radius="md" padding={0} className={pageClasses.tableCard}>
              <Table.ScrollContainer minWidth={520}>
                <Table>
                  <Table.Thead>
                    <Table.Tr>
                      <Table.Th>Rank</Table.Th>
                      <Table.Th>Team</Table.Th>
                      <Table.Th>Wins</Table.Th>
                      <Table.Th>Losses</Table.Th>
                    </Table.Tr>
                  </Table.Thead>
                  <Table.Tbody>
                    {data.standings.map((row) => (
                      <Table.Tr key={row.teamId}>
                        <Table.Td fw={700}>{row.rank}</Table.Td>
                        <Table.Td>{row.teamName || row.teamId}</Table.Td>
                        <Table.Td>{row.wins}</Table.Td>
                        <Table.Td>{row.losses}</Table.Td>
                      </Table.Tr>
                    ))}
                  </Table.Tbody>
                </Table>
              </Table.ScrollContainer>
            </Card>
          </Stack>
        )}
      </Stack>
    </section>
  );
}
