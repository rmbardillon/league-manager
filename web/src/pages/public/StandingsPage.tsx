/**
 * Public standings view (Req 10.4, 10.5, 10.6).
 *
 * Lists a Season's Standings — each row's rank, Team, wins, and losses. Open
 * Seasons are computed live; closed Seasons return the recorded snapshot, which
 * the view labels for clarity (Req 10.5). No sign-in is required (Req 10.6).
 */
import { useSearchParams } from 'react-router-dom';
import { publicApi, type StandingsPayload } from '../../api/index.js';
import { useAsync } from '../../hooks/useAsync.js';
import { PublicSeasonSelect } from '../../components/PublicSeasonSelect.js';
import { EmptyMessage, ErrorMessage, LoadingIndicator } from '../../components/Feedback.js';

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
      <h2 id="standings-heading">Standings</h2>
      <PublicSeasonSelect value={seasonId || null} onChange={setSeason} id="standings-season-id" />

      {!seasonId && <EmptyMessage>Select a Season to view its standings.</EmptyMessage>}
      {loading && <LoadingIndicator label="Loading standings…" />}
      {error && <ErrorMessage>{error}</ErrorMessage>}

      {data && data.standings.length === 0 && (
        <EmptyMessage>
          {data.message ?? 'No Standings are available for this Season yet.'}
        </EmptyMessage>
      )}

      {data && data.standings.length > 0 && (
        <>
          {data.closed && (
            <p role="status" className="badge">
              These are the final standings recorded when the Season closed.
            </p>
          )}
          <table>
            <caption>
              Standings for Season {data.seasonId}
              {data.closed ? ' (final)' : ' (current)'}
            </caption>
            <thead>
              <tr>
                <th scope="col">Rank</th>
                <th scope="col">Team</th>
                <th scope="col">Wins</th>
                <th scope="col">Losses</th>
              </tr>
            </thead>
            <tbody>
              {data.standings.map((row) => (
                <tr key={row.teamId}>
                  <td>{row.rank}</td>
                  <td>{row.teamName || row.teamId}</td>
                  <td>{row.wins}</td>
                  <td>{row.losses}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}
    </section>
  );
}
