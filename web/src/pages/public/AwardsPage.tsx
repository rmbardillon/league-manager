/**
 * Public awards view (Req 13.15).
 *
 * Shows the published Awards for a scope (Season or Tournament). Viewers see
 * exactly the published subset — unpublished Awards remain hidden (Req 13.14,
 * 13.15). No sign-in is required.
 *
 * The scope is chosen via the `season` URL query parameter (reused here as the
 * scope id, since a Season is the common scope) so the view is deep-linkable.
 */
import { useSearchParams } from 'react-router-dom';
import {
  publicApi,
  type AwardCategory,
  type PublishedAwardsPayload,
} from '../../api/index.js';
import { useAsync } from '../../hooks/useAsync.js';
import { SeasonPicker } from '../../components/SeasonPicker.js';
import { EmptyMessage, ErrorMessage, LoadingIndicator } from '../../components/Feedback.js';

/** Human-readable labels for each Award category. */
const CATEGORY_LABELS: Record<AwardCategory, string> = {
  MVP: 'Most Valuable Player',
  Mythical_5: 'Mythical Five',
  Best_in_3_Pointers: 'Best in 3-Pointers',
  DPOY: 'Defensive Player of the Year',
  Assists_Leader: 'Assists Leader',
  Finals_MVP: 'Finals MVP',
};

export function AwardsPage(): JSX.Element {
  const [params, setParams] = useSearchParams();
  const scopeId = params.get('season') ?? '';

  const { data, loading, error } = useAsync<PublishedAwardsPayload>(
    (signal) => publicApi.publishedAwards(scopeId, signal),
    scopeId || null,
  );

  const setScope = (id: string): void => {
    setParams(id ? { season: id } : {});
  };

  return (
    <section aria-labelledby="awards-heading">
      <h2 id="awards-heading">Published Awards</h2>
      <SeasonPicker
        value={scopeId}
        onChange={setScope}
        label="Season / Tournament ID"
        inputId="awards-scope-id"
      />

      {!scopeId && (
        <EmptyMessage>Enter a Season or Tournament ID to view its published awards.</EmptyMessage>
      )}
      {loading && <LoadingIndicator label="Loading awards…" />}
      {error && <ErrorMessage>{error}</ErrorMessage>}

      {data && data.awards.length === 0 && (
        <EmptyMessage>{data.message ?? 'No awards have been published yet.'}</EmptyMessage>
      )}

      {data && data.awards.length > 0 && (
        <ul className="awards-list">
          {data.awards.map((award) => (
            <li key={award.id}>
              <h3>{CATEGORY_LABELS[award.category]}</h3>
              {award.playerIds.length === 1 ? (
                <p>Player: {award.playerIds[0]}</p>
              ) : (
                <ol>
                  {award.playerIds.map((playerId) => (
                    <li key={playerId}>{playerId}</li>
                  ))}
                </ol>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
