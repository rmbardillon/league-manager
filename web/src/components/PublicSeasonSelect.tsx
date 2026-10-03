/**
 * Public Season selector for the unauthenticated browsing views.
 *
 * The public schedule/results/standings/awards views are keyed by a Season (or
 * scope) id. Rather than ask a viewer to read, remember, or type a raw id, this
 * control presents the Seasons available for public browsing by name and
 * resolves the chosen option back to the Season id (Req 7.1, 7.2).
 *
 * A thin wrapper over {@link EntitySelect} bound to `publicApi.seasons` via
 * {@link useResourceList}. The payload is `PublicSeasonsPayload { seasons,
 * message? }`, so the loader maps to the `seasons` array. Its list key is the
 * stable `/public/seasons`, so it loads immediately (no parent to gate on).
 *
 * When no Seasons are available the control shows an accessible empty-state
 * message with no free-text id fallback (Req 7.3), handled by EntitySelect.
 */
import { useCallback } from 'react';

import { publicApi } from '../api/index.js';
import type { PublicSeasonSummary } from '../api/index.js';
import { useResourceList } from '../hooks/useResourceList.js';
import { EntitySelect } from './selectors/EntitySelect.js';

export interface PublicSeasonSelectProps {
  /** The currently selected Season id, or `null` when nothing is selected. */
  value: string | null;
  /** Called with the selected Season id (or `null` when cleared). */
  onChange: (id: string | null) => void;
  /** Programmatic label for the combobox; defaults to "Season". */
  label?: string;
  /** Explicit element id for the underlying input, so callers can wire descriptions. */
  id?: string;
}

export function PublicSeasonSelect({
  value,
  onChange,
  label = 'Season',
  id,
}: PublicSeasonSelectProps): JSX.Element {
  const loader = useCallback(
    (signal: AbortSignal) => publicApi.seasons(signal).then((payload) => payload.seasons),
    [],
  );

  const { items, loading, error, reload } = useResourceList<PublicSeasonSummary>(
    loader,
    '/public/seasons',
  );

  return (
    <EntitySelect
      label={label}
      items={items}
      getId={(season) => season.id}
      getLabel={(season) => season.name}
      value={value}
      onChange={onChange}
      loading={loading}
      error={error}
      onRetry={reload}
      emptyMessage="No seasons are available for browsing yet."
      id={id}
    />
  );
}
