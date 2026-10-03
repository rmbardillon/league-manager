/**
 * Tournament format selector (Req 8.2, 8.3).
 *
 * A static-value {@link EntitySelect}: it presents the three valid
 * {@link TournamentFormat} values by a human-readable label and yields the raw
 * format string, so the create-Tournament form can only ever offer a valid
 * format and never a free-text id.
 */
import type { TournamentFormat } from '../../api';
import { EntitySelect } from './EntitySelect.js';

interface FormatOption {
  id: TournamentFormat;
  name: string;
}

/** The complete, closed set of valid tournament formats. */
const FORMAT_OPTIONS: readonly FormatOption[] = [
  { id: 'single-elimination', name: 'Single Elimination' },
  { id: 'double-elimination', name: 'Double Elimination' },
  { id: 'round-robin', name: 'Round Robin' },
];

export interface TournamentFormatSelectProps {
  /** The currently selected format, or `null` when nothing is selected. */
  value: TournamentFormat | null;
  /** Called with the selected format (or `null` when cleared). */
  onChange: (value: TournamentFormat | null) => void;
  /** Programmatic label for the combobox. */
  label?: string;
  /** Whether a selection is required. */
  required?: boolean;
  /** Disable the control. */
  disabled?: boolean;
}

/**
 * A labeled combobox over the valid {@link TournamentFormat} values. The
 * underlying {@link EntitySelect} value is the format string itself.
 */
export function TournamentFormatSelect({
  value,
  onChange,
  label = 'Format',
  required = false,
  disabled = false,
}: TournamentFormatSelectProps): JSX.Element {
  return (
    <EntitySelect
      label={label}
      items={FORMAT_OPTIONS as FormatOption[]}
      getId={(item) => item.id}
      getLabel={(item) => item.name}
      value={value}
      onChange={(id) => onChange(id as TournamentFormat | null)}
      required={required}
      disabled={disabled}
      placeholder="Select a format…"
    />
  );
}
