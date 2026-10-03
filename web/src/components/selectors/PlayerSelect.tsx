/**
 * Master-Player selector for the Roster view.
 *
 * A thin wrapper over {@link EntitySelect} bound to `playersApi.listMasters`
 * via {@link useResourceList}. Its list key is always `/players`; unlike the
 * League→Season→Team cascade it is not gated on a parent id — it is loaded for
 * the Roster view directly (Req 3.9).
 *
 * It lists master Players by name. Because master-Player names are not unique,
 * the option value is always the Player id, so two people sharing a name stay
 * unambiguous (Req 3.9; the invariant Correctness Property 1 covers). Loading/
 * empty/error presentation is handled by EntitySelect.
 */
import { useCallback } from 'react';

import { playersApi } from '../../api/index.js';
import type { Player } from '../../api/index.js';
import { useResourceList } from '../../hooks/useResourceList.js';
import { EntitySelect } from './EntitySelect.js';

export interface PlayerSelectProps {
  /** The currently selected Player id, or `null` when nothing is selected. */
  value: string | null;
  /** Called with the selected Player id (or `null` when cleared). */
  onChange: (id: string | null) => void;
  /** Programmatic label for the combobox; defaults to "Player". */
  label?: string;
  /** Whether a selection is required. */
  required?: boolean;
  /** Disable the control independent of its loading state. */
  disabled?: boolean;
}

export function PlayerSelect({
  value,
  onChange,
  label = 'Player',
  required,
  disabled,
}: PlayerSelectProps): JSX.Element {
  const loader = useCallback(
    (signal: AbortSignal) => playersApi.listMasters(signal),
    [],
  );

  const { items, loading, error, reload } = useResourceList<Player>(
    loader,
    '/players',
  );

  return (
    <EntitySelect
      label={label}
      items={items}
      getId={(player) => player.id}
      getLabel={(player) => player.name}
      value={value}
      onChange={onChange}
      loading={loading}
      error={error}
      onRetry={reload}
      emptyMessage="No players registered yet."
      required={required}
      disabled={disabled}
    />
  );
}
