/**
 * Public schedule view (Req 10.1, 10.6).
 *
 * Lists a Season's scheduled Games — ordered by date then start time by the
 * backend — with each entry's date, start time, Venue, and both Teams. No
 * sign-in is required (Req 10.6). The Season is chosen via the `season` URL
 * query parameter so the view is deep-linkable.
 *
 * An empty schedule renders the backend's informational message (Req 10.2)
 * rather than an error.
 */
import { useSearchParams } from 'react-router-dom';
import { Card, Stack, Table, Title } from '@mantine/core';
import { publicApi, type SchedulePayload } from '../../api/index.js';
import { useAsync } from '../../hooks/useAsync.js';
import { PublicSeasonSelect } from '../../components/PublicSeasonSelect.js';
import { EmptyMessage, ErrorMessage, LoadingIndicator } from '../../components/Feedback.js';
import pageClasses from './PublicPage.module.css';

export function SchedulePage(): JSX.Element {
  const [params, setParams] = useSearchParams();
  const seasonId = params.get('season') ?? '';

  const { data, loading, error } = useAsync<SchedulePayload>(
    (signal) => publicApi.schedule(seasonId, signal),
    seasonId || null,
  );

  const setSeason = (id: string | null): void => {
    setParams(id ? { season: id } : {});
  };

  return (
    <section aria-labelledby="schedule-heading">
      <Stack gap="lg">
        <Title order={2} id="schedule-heading" className={pageClasses.pageTitle}>
          Schedule
        </Title>
        <Card withBorder radius="md" padding="md" maw={420}>
          <PublicSeasonSelect value={seasonId || null} onChange={setSeason} id="schedule-season-id" />
        </Card>

        {!seasonId && <EmptyMessage>Select a Season to view its schedule.</EmptyMessage>}
        {loading && <LoadingIndicator label="Loading schedule…" />}
        {error && <ErrorMessage>{error}</ErrorMessage>}

        {data && data.games.length === 0 && (
          <EmptyMessage>{data.message ?? 'No Games are scheduled for this Season.'}</EmptyMessage>
        )}

        {data && data.games.length > 0 && (
          <Card withBorder radius="md" padding={0} className={pageClasses.tableCard}>
            <Table.ScrollContainer minWidth={640}>
              <Table>
                <Table.Thead>
                  <Table.Tr>
                    <Table.Th>Date</Table.Th>
                    <Table.Th>Start time</Table.Th>
                    <Table.Th>Venue</Table.Th>
                    <Table.Th>Home</Table.Th>
                    <Table.Th>Away</Table.Th>
                  </Table.Tr>
                </Table.Thead>
                <Table.Tbody>
                  {data.games.map((game) => (
                    <Table.Tr key={game.gameId}>
                      <Table.Td>{game.date}</Table.Td>
                      <Table.Td>{game.startTime ?? 'TBD'}</Table.Td>
                      <Table.Td>{game.venue ?? 'TBD'}</Table.Td>
                      <Table.Td>{game.homeTeamName || game.homeTeamId}</Table.Td>
                      <Table.Td>{game.awayTeamName || game.awayTeamId}</Table.Td>
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
