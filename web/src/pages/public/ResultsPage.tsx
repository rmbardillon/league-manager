/**
 * Public results view (Req 10.3, 10.6).
 *
 * Lists a Season's completed Games with both Teams' final Scores and the date
 * each Game was completed. No sign-in is required (Req 10.6). An empty result
 * set renders the informational message rather than an error.
 */
import { useSearchParams } from 'react-router-dom';
import { publicApi, type ResultsPayload } from '../../api/index.js';
import { useAsync } from '../../hooks/useAsync.js';
import { SeasonPicker } from '../../components/SeasonPicker.js';
import { EmptyMessage, ErrorMessage, LoadingIndicator } from '../../components/Feedback.js';

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

  const setSeason = (id: string): void => {
    setParams(id ? { season: id } : {});
  };

  return (
    <section aria-labelledby="results-heading">
      <h2 id="results-heading">Results</h2>
      <SeasonPicker value={seasonId} onChange={setSeason} inputId="results-season-id" />

      {!seasonId && <EmptyMessage>Enter a Season ID to view its results.</EmptyMessage>}
      {loading && <LoadingIndicator label="Loading results…" />}
      {error && <ErrorMessage>{error}</ErrorMessage>}

      {data && data.games.length === 0 && (
        <EmptyMessage>
          {data.message ?? 'No completed Games are available for this Season yet.'}
        </EmptyMessage>
      )}

      {data && data.games.length > 0 && (
        <table>
          <caption>Completed Games for Season {data.seasonId}</caption>
          <thead>
            <tr>
              <th scope="col">Home</th>
              <th scope="col">Score</th>
              <th scope="col">Away</th>
              <th scope="col">Score</th>
              <th scope="col">Completed</th>
            </tr>
          </thead>
          <tbody>
            {data.games.map((game) => (
              <tr key={game.gameId}>
                <td>{game.homeTeamName || game.homeTeamId}</td>
                <td>{game.homeScore}</td>
                <td>{game.awayTeamName || game.awayTeamId}</td>
                <td>{game.awayScore}</td>
                <td>{formatDate(game.completedAt)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}
