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
import { publicApi, type SchedulePayload } from '../../api/index.js';
import { useAsync } from '../../hooks/useAsync.js';
import { PublicSeasonSelect } from '../../components/PublicSeasonSelect.js';
import { EmptyMessage, ErrorMessage, LoadingIndicator } from '../../components/Feedback.js';

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
      <h2 id="schedule-heading">Schedule</h2>
      <PublicSeasonSelect value={seasonId || null} onChange={setSeason} id="schedule-season-id" />

      {!seasonId && <EmptyMessage>Select a Season to view its schedule.</EmptyMessage>}
      {loading && <LoadingIndicator label="Loading schedule…" />}
      {error && <ErrorMessage>{error}</ErrorMessage>}

      {data && data.games.length === 0 && (
        <EmptyMessage>{data.message ?? 'No Games are scheduled for this Season.'}</EmptyMessage>
      )}

      {data && data.games.length > 0 && (
        <table>
          <caption>Scheduled Games for Season {data.seasonId}</caption>
          <thead>
            <tr>
              <th scope="col">Date</th>
              <th scope="col">Start time</th>
              <th scope="col">Venue</th>
              <th scope="col">Home</th>
              <th scope="col">Away</th>
            </tr>
          </thead>
          <tbody>
            {data.games.map((game) => (
              <tr key={game.gameId}>
                <td>{game.date}</td>
                <td>{game.startTime ?? 'TBD'}</td>
                <td>{game.venue ?? 'TBD'}</td>
                <td>{game.homeTeamName || game.homeTeamId}</td>
                <td>{game.awayTeamName || game.awayTeamId}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}
