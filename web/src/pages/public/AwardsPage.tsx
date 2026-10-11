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
import { Card, List, SimpleGrid, Stack, Text, Title } from '@mantine/core';
import {
  publicApi,
  type AwardCategory,
  type PublishedAwardsPayload,
} from '../../api/index.js';
import { useAsync } from '../../hooks/useAsync.js';
import { PublicSeasonSelect } from '../../components/PublicSeasonSelect.js';
import { EmptyMessage, ErrorMessage, LoadingIndicator } from '../../components/Feedback.js';
import pageClasses from './PublicPage.module.css';

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

  const setScope = (id: string | null): void => {
    setParams(id ? { season: id } : {});
  };

  return (
    <section aria-labelledby="awards-heading">
      <Stack gap="lg">
        <Title order={2} id="awards-heading" className={pageClasses.pageTitle}>
          Published Awards
        </Title>
        <Card withBorder radius="md" padding="md" maw={420}>
          <PublicSeasonSelect
            value={scopeId || null}
            onChange={setScope}
            label="Season"
            id="awards-scope-id"
          />
        </Card>

        {!scopeId && (
          <EmptyMessage>Select a Season to view its published awards.</EmptyMessage>
        )}
        {loading && <LoadingIndicator label="Loading awards…" />}
        {error && <ErrorMessage>{error}</ErrorMessage>}

        {data && data.awards.length === 0 && (
          <EmptyMessage>{data.message ?? 'No awards have been published yet.'}</EmptyMessage>
        )}

        {data && data.awards.length > 0 && (
          <SimpleGrid cols={{ base: 1, sm: 2, md: 3 }} spacing="md">
            {data.awards.map((award) => (
              <Card key={award.id} withBorder radius="md" padding="lg">
                <Stack gap="xs">
                  <Text className={pageClasses.pageTitle} fw={800} fz="h3" style={{ border: 0, padding: 0 }}>
                    {CATEGORY_LABELS[award.category]}
                  </Text>
                  {award.playerIds.length === 1 ? (
                    <Text>{award.playerIds[0]}</Text>
                  ) : (
                    <List type="ordered" withPadding>
                      {award.playerIds.map((playerId) => (
                        <List.Item key={playerId}>{playerId}</List.Item>
                      ))}
                    </List>
                  )}
                </Stack>
              </Card>
            ))}
          </SimpleGrid>
        )}
      </Stack>
    </section>
  );
}
