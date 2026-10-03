/**
 * League selector — the root of the management cascade.
 *
 * A thin wrapper over {@link EntitySelect} bound to `leaguesApi.list` via
 * {@link useResourceList}. Its list key is always `/leagues`, so it loads
 * immediately (it has no parent to gate on). Choosing a League drives the
 * downstream {@link SeasonSelect} (Req 3.2, 3.3).
 *
 * Entities are presented by name; the chosen option resolves to the League id
 * (Req 3.1, 3.5). Loading/empty/error presentation is handled by EntitySelect.
 */
import { useCallback } from 'react';

import { leaguesApi } from '../../api/index.js';
import type { LeagueSummary } from '../../api/index.js';
import { useResourceList } from '../../hooks/useResourceList.js';
import { EntitySelect } from './EntitySelect.js';

export interface LeagueSelectProps {
  /** The currently selected League id, or `null` when nothing is selected. */
  value: string | null;
  /** Called with the selected League id (or `null` when cleared). */
  onChange: (id: string | null) => void;
  /** Programmatic label for the combobox; defaults to "League". */
  label?: string;
  /** Whether a selection is required. */
  required?: boolean;
  /** Disable the control independent of its loading state. */
  disabled?: boolean;
}

export function LeagueSelect({
  value,
  onChange,
  label = 'League',
  required,
  disabled,
}: LeagueSelectProps): JSX.Element {
  const loader = useCallback(
    (signal: AbortSignal) => leaguesApi.list(signal),
    [],
  );

  const { items, loading, error, reload } = useResourceList<LeagueSummary>(
    loader,
    '/leagues',
  );

  return (
    <EntitySelect
      label={label}
      items={items}
      getId={(league) => league.id}
      getLabel={(league) => league.name}
      value={value}
      onChange={onChange}
      loading={loading}
      error={error}
      onRetry={reload}
      emptyMessage="No leagues available."
      required={required}
      disabled={disabled}
    />
  );
}
