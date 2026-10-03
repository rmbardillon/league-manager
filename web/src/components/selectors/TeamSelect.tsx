/**
 * Team selector — cascades off a chosen Season.
 *
 * A thin wrapper over {@link EntitySelect} bound to `seasonsApi.teams` via
 * {@link useResourceList}. Its list key is `/seasons/{seasonId}/teams` when a
 * `seasonId` is selected and `null` otherwise, so the hook skips the load until
 * a parent Season is chosen and resets this list whenever the Season is cleared
 * (Req 3.3, 3.4).
 *
 * Entities are presented by name; the chosen option resolves to the Team id
 * (Req 3.1, 3.5). Loading/empty/error presentation is handled by EntitySelect.
 */
import { useCallback } from 'react';

import { seasonsApi } from '../../api/index.js';
import type { TeamSummary } from '../../api/index.js';
import { useResourceList } from '../../hooks/useResourceList.js';
import { EntitySelect } from './EntitySelect.js';

export interface TeamSelectProps {
  /** The parent Season whose Teams are listed; `null` gates the load. */
  seasonId: string | null;
  /** The currently selected Team id, or `null` when nothing is selected. */
  value: string | null;
  /** Called with the selected Team id (or `null` when cleared). */
  onChange: (id: string | null) => void;
  /** Programmatic label for the combobox; defaults to "Team". */
  label?: string;
  /** Whether a selection is required. */
  required?: boolean;
  /** Disable the control independent of its loading state. */
  disabled?: boolean;
}

export function TeamSelect({
  seasonId,
  value,
  onChange,
  label = 'Team',
  required,
  disabled,
}: TeamSelectProps): JSX.Element {
  const loader = useCallback(
    (signal: AbortSignal) => seasonsApi.teams(seasonId as string, signal),
    [seasonId],
  );

  const key = seasonId !== null ? `/seasons/${seasonId}/teams` : null;

  const { items, loading, error, reload } = useResourceList<TeamSummary>(
    loader,
    key,
  );

  return (
    <EntitySelect
      label={label}
      items={items}
      getId={(team) => team.id}
      getLabel={(team) => team.name}
      value={value}
      onChange={onChange}
      loading={loading}
      error={error}
      onRetry={reload}
      emptyMessage={
        seasonId === null
          ? 'Select a season first.'
          : 'No teams available for this season.'
      }
      required={required}
      disabled={disabled}
    />
  );
}
