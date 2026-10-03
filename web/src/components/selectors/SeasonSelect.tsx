/**
 * Season selector — cascades off a chosen League.
 *
 * A thin wrapper over {@link EntitySelect} bound to `leaguesApi.seasons` via
 * {@link useResourceList}. Its list key is `/leagues/{leagueId}/seasons` when a
 * `leagueId` is selected and `null` otherwise, so the hook skips the load until
 * a parent League is chosen and resets this list whenever the League is cleared
 * (Req 3.3, 3.4).
 *
 * Entities are presented by name; the chosen option resolves to the Season id
 * (Req 3.1, 3.5). Loading/empty/error presentation is handled by EntitySelect.
 */
import { useCallback } from 'react';

import { leaguesApi } from '../../api/index.js';
import type { SeasonSummary } from '../../api/index.js';
import { useResourceList } from '../../hooks/useResourceList.js';
import { EntitySelect } from './EntitySelect.js';

export interface SeasonSelectProps {
  /** The parent League whose Seasons are listed; `null` gates the load. */
  leagueId: string | null;
  /** The currently selected Season id, or `null` when nothing is selected. */
  value: string | null;
  /** Called with the selected Season id (or `null` when cleared). */
  onChange: (id: string | null) => void;
  /** Programmatic label for the combobox; defaults to "Season". */
  label?: string;
  /** Whether a selection is required. */
  required?: boolean;
  /** Disable the control independent of its loading state. */
  disabled?: boolean;
}

export function SeasonSelect({
  leagueId,
  value,
  onChange,
  label = 'Season',
  required,
  disabled,
}: SeasonSelectProps): JSX.Element {
  const loader = useCallback(
    (signal: AbortSignal) => leaguesApi.seasons(leagueId as string, signal),
    [leagueId],
  );

  const key = leagueId !== null ? `/leagues/${leagueId}/seasons` : null;

  const { items, loading, error, reload } = useResourceList<SeasonSummary>(
    loader,
    key,
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
      emptyMessage={
        leagueId === null
          ? 'Select a league first.'
          : 'No seasons available for this league.'
      }
      required={required}
      disabled={disabled}
    />
  );
}
