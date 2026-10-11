/**
 * Public results view (Req 10.3, 10.6).
 *
 * Lists a Season's completed Games with both Teams' final Scores and the date
 * each Game was completed. No sign-in is required (Req 10.6). An empty result
 * set renders the informational message rather than an error.
 */
import { useSearchParams } from 'react-router-dom';
import { Card, Stack, Table, Title } from '@mantine/core';
import { publicApi, type ResultsPayload } from '../../api/index.js';
import { useAsync } from '../../hooks/useAsync.js';
import { PublicSeasonSelect } from '../../components/PublicSeasonSelect.js';
import { EmptyMessage, ErrorMessage, LoadingIndicator } from '../../components/Feedback.js';
import pageClasses from './PublicPage.module.css';

/** Format an ISO timestamp as a local calendar date for display. */
function formatDate(iso: string): string {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? iso : date.toLocaleDateString();
}

export function ResultsPage(): JSX.Element {
  const [params, setParams] = useSearchParams();
  const seasonId = params.get('season') ?? '';

  const { data, loading, error } = useAsync<ResultsPayload>(
    (signal) => publicApi.results(seasonId, signal),
    seasonId || null,
  );

  const setSeason = (id: string | null): void => {
    setParams(id ? { season: id } : {});
  };

  return (
    <section aria-labelledby="results-heading">
      <Stack gap="lg">
        <Title order={2} id="results-heading" className={pageClasses.pageTitle}>
          Results
        </Title>
        <Card withBorder radius="md" padding="md" maw={420}>
          <PublicSeasonSelect value={seasonId || null} onChange={setSeason} id="results-season-id" />
        </Card>

        {!seasonId && <EmptyMessage>Select a Season to view its results.</EmptyMessage>}
        {loading && <LoadingIndicator label="Loading results…" />}
        {error && <ErrorMessage>{error}</ErrorMessage>}

        {data && data.games.length === 0 && (
          <EmptyMessage>
            {data.message ?? 'No completed Games are available for this Season yet.'}
          </EmptyMessage>
        )}

        {data && data.games.length > 0 && (
          <Card withBorder radius="md" padding={0} className={pageClasses.tableCard}>
            <Table.ScrollContainer minWidth={640}>
              <Table>
                <Table.Thead>
                  <Table.Tr>
                    <Table.Th>Home</Table.Th>
                    <Table.Th>Score</Table.Th>
                    <Table.Th>Away</Table.Th>
                    <Table.Th>Score</Table.Th>
                    <Table.Th>Completed</Table.Th>
                  </Table.Tr>
                </Table.Thead>
                <Table.Tbody>
                  {data.games.map((game) => (
                    <Table.Tr key={game.gameId}>
                      <Table.Td>{game.homeTeamName || game.homeTeamId}</Table.Td>
                      <Table.Td fw={700}>{game.homeScore}</Table.Td>
                      <Table.Td>{game.awayTeamName || game.awayTeamId}</Table.Td>
                      <Table.Td fw={700}>{game.awayScore}</Table.Td>
                      <Table.Td>{formatDate(game.completedAt)}</Table.Td>
                    </Table.Tr>
                  ))}
                </Table.Tbody>
              </Table>
            </Table.ScrollContainer>
          </Card>
        )}
      </Stack>
    </section>
  );
}
